/* Vectorizer Bridge - minimal JSON for ExtendScript.
   Illustrator's ExtendScript is ECMAScript 3, which has no JSON object at all.
   Every JSON.stringify/JSON.parse in the host scripts used to throw
   "JSON is undefined" - including inside catch blocks, which hid the real
   errors. This file defines JSON once, before the other host scripts run. */

if (typeof JSON === "undefined") {
  JSON = {};
}

if (typeof JSON.stringify !== "function") {
  JSON.stringify = (function () {
    /* Characters that must be escaped inside a JSON string. */
    var escapable = /[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var meta = {
      "\b": "\\b",
      "\t": "\\t",
      "\n": "\\n",
      "\f": "\\f",
      "\r": "\\r",
      '"': '\\"',
      "\\": "\\\\"
    };

    function quote(string) {
      var s = String(string);
      escapable.lastIndex = 0;
      if (!escapable.test(s)) return '"' + s + '"';
      return '"' + s.replace(escapable, function (a) {
        var c = meta[a];
        return typeof c === "string"
          ? c
          : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"';
    }

    /* instanceof alone can miss an array created in another engine context,
       which is how a value can arrive from a different host script. */
    function isArray(value) {
      try {
        if (value instanceof Array) return true;
      } catch (e) { }
      try {
        return String(Object.prototype.toString.call(value)) === "[object Array]";
      } catch (e2) {
        return false;
      }
    }

    function str(value, depth) {
      var i, key, parts, v;
      if (depth > 64) throw new Error("JSON.stringify: too deep");

      if (value === null || value === undefined) return "null";

      var t = typeof value;
      if (t === "number") return isFinite(value) ? String(value) : "null";
      if (t === "boolean") return value ? "true" : "false";
      if (t === "string") return quote(value);

      if (t === "object") {
        if (isArray(value)) {
          parts = [];
          for (i = 0; i < value.length; i++) parts.push(str(value[i], depth + 1));
          return "[" + parts.join(",") + "]";
        }
        parts = [];
        for (key in value) {
          // Host objects may have no hasOwnProperty; never let that throw.
          if (typeof value.hasOwnProperty === "function" && !value.hasOwnProperty(key)) continue;
          v = str(value[key], depth + 1);
          parts.push(quote(key) + ":" + v);
        }
        return "{" + parts.join(",") + "}";
      }

      return "null";
    }

    return function (value) { return str(value, 0); };
  })();
}

if (typeof JSON.parse !== "function") {
  JSON.parse = function (text) {
    var src = String(text);
    if (!src) throw new SyntaxError("JSON.parse: empty input");

    /* Crockford-style validation before eval, so only JSON-looking input is
       evaluated. The panel is the only caller and always sends its own data. */
    if (!/^[\],:{}\s]*$/.test(
      src.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
         .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
         .replace(/(?:^|:|,)(?:\s*\[)+/g, "")
    )) {
      throw new SyntaxError("JSON.parse: invalid JSON");
    }

    return eval("(" + src + ")");
  };
}
