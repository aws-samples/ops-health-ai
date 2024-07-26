import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { PutObjectCommand } from '@aws-sdk/client-s3';

const options = {
  spacing: true,
  hierarchy: true,
  separator: ":",
  squareBracketsForArray: false,
  doubleQuotesForKeys: false,
  doubleQuotesForValues: false
}
const s3 = new S3Client();
const s3Target = new S3Client({ region: process.env.TARGET_S3_REGION });

export const lambdaHandler = async (event, context) => {
  console.log("Incoming event: ", JSON.stringify(event, null, 2))
  for (const record of event.Records) {
    let eventBody = JSON.parse(record.body)
    let eventSource = eventBody.source ? eventBody.source : ""
    let eventId = eventBody.id ? eventBody.id : "dummy"
    let targetS3 = ""
    let eventRegion = ""
    let accountId = ""

    switch (eventSource.split(".")[1]) {
      case "trustedadvisor":
        console.log("Parsing as Trusted Advisor event...")
        targetS3 = process.env.TA_FINDINGS_s3
        eventRegion = eventBody.region ? eventBody.region : "dummy"
        accountId = eventBody.account ? eventBody.account : "dummy"
        break;
      case "health":
        console.log("Parsing as AWS Health event...")
        targetS3 = process.env.OPS_HEALTH_S3
        eventRegion = eventBody.region ? eventBody.region : "dummy"
        accountId = eventBody.account ? eventBody.account : "dummy"
        break;
      case "securityhub":
        console.log("Parsing as SecurityHub event...")
        targetS3 = process.env.SEC_FINDINGs_S3
        eventRegion = eventBody.region ? eventBody.region : "dummy"
        accountId = eventBody.account ? eventBody.account : "dummy"
        break;
      default:
        console.log(`Event source - ${eventSource} not recognized, ignoring...`)
        return
    }

    let plainText = jsonToPlainText(eventBody, options);
    let s3ObjKey = `${eventSource}/${eventRegion}/${accountId}/${eventId}.txt`
    console.log("Converted plain text: ", plainText);
    console.log("Saving to: ", `${targetS3}/${s3ObjKey}`);
    return await uploadFile(targetS3, s3ObjKey, plainText)
  }
}

/* function using AWS SDK v3 to download a file from aws s3 bucket with the given bucket name and file path */
const downloadFile = async (bucketName, filePath) => {
  const params = { Bucket: bucketName, Key: filePath };
  const data = await s3.send(new GetObjectCommand(params));
  const fileContent = data.Body.transformToString();
  return fileContent;
}

/* function using AWS SDK v3 to take a string input and upload as a text file to aws s3 bucket with the given bucket name and file path */
const uploadFile = async (bucketName, filePath, fileContent) => {
  const params = { Bucket: bucketName, Key: filePath, Body: fileContent };
  return s3Target.send(new PutObjectCommand(params));
}

/* function to convert json to plain text */
function jsonToPlainText(data, options) {
  const visited = new Set();
  let indentLevel = 1;
  const defaultOptions = {
    spacing: false,
    hierarchy: false,
    separator: ":",
    squareBracketsForArray: false,
    doubleQuotesForKeys: false,
    doubleQuotesForValues: false,
  };
  const mergedOptions = { ...defaultOptions, ...options }; // Merge user-provided options with default options
  const outputOptions = {
    spacing: mergedOptions.spacing,
    hierarchy: mergedOptions.hierarchy,
    separator: mergedOptions.separator,
    squareBracketsForArray: mergedOptions.squareBracketsForArray,
    doubleQuotesForKeys: mergedOptions.doubleQuotesForKeys,
    doubleQuotesForValues: mergedOptions.doubleQuotesForValues,
  };
  // Helper function to determine the type of a variable
  function getType(variable) {
    const type = typeof variable;
    // Identify the specific type for object-like variables (null, array, object, date, regexp)
    if (type === "object") {
      if (variable === null)
        return "null";
      if (Array.isArray(variable))
        return "array";
      if (variable instanceof Date)
        return "date";
      if (variable instanceof RegExp)
        return "regexp";
      return "object";
    }
    return type;
  }
  // Helper function to handle arrays
  function handleArray(arr) {
    let output = "";
    if (arr.length === 0) {
      output += "[]";
      return output;
    }
    arr.forEach((item, index) => {
      const handler = handlers[getType(item)];
      if (!handler) {
        throw new Error("Unsupported data type: " + getType(item));
      }
      if (index === 0) {
        output += handler(item, true);
      }
      else {
        output += ", " + handler(item, true);
      }
    });
    return outputOptions.squareBracketsForArray ? "[ " + output + " ]" : output;
  }
  // Helper function to handle objects
  function handleObject(obj) {
    let output = "";
    if (Object.keys(obj).length === 0) {
      output += "{}";
      return output;
    }
    const keys = Object.keys(obj);
    keys.forEach((key, index) => {
      const value = obj[key];
      const handler = handlers[getType(value)];
      if (typeof value === "undefined") {
        return;
      }
      if (!handler) {
        throw new Error("Unsupported data type: " + getType(value));
      }
      if (key.length >= indentLevel) {
        indentLevel = key.length;
      }
      output +=
        "\n" + (outputOptions.hierarchy
          ? "\t".repeat(visited.size - 1)
          : "") +
        (outputOptions.doubleQuotesForKeys
          ? '"' + key + '"'
          : key) +
        "}json-to-plain-text-special-string-" +
        key.length +
        "{" +
        handler(value, true);
    });
    return output;
  }
  // Handlers for different data types
  const handlers = {
    undefined: function () {
      return "null";
    },
    null: function () {
      return "null";
    },
    // Handle numbers
    number: function (x) {
      return x.toString();
    },
    // Handle booleans
    boolean: function (x) {
      return x ? "true" : "false";
    },
    // Handle strings
    string: function (x) {
      const str = x.toString();
      return outputOptions.doubleQuotesForValues ? '"' + str + '"' : str;
    },
    // Handle arrays, check for circular references
    array: function (x) {
      if (visited.has(x)) {
        return "[Circular]";
      }
      visited.add(x);
      const output = handleArray(x);
      visited.delete(x);
      return output;
    },
    // Handle objects, check for circular references
    object: function (x, inArray) {
      if (visited.has(x)) {
        return "[Circular]";
      }
      visited.add(x);
      const output = handleObject(x);
      visited.delete(x);
      return output;
    },
    // Handle dates
    date: function (x) {
      return x.toISOString();
    },
    // Handle regular expressions
    regexp: function (x) {
      return x.toString();
    },
    // Handle functions
    function: function () {
      return "[object Function]";
    },
  };
  // Start the conversion with the root data and return the final result
  return handlers[getType(data)](data, false).replace(/}json-to-plain-text-special-string-(\d+){/g, (match, number) => {
    const space = parseInt(number, 10);
    return outputOptions.spacing
      ? " ".repeat(indentLevel - space) + ` ${outputOptions.separator} `
      : ` ${outputOptions.separator} `;
  });
}