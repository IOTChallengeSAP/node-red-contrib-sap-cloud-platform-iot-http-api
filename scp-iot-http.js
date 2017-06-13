"use strict";

var request = require('request');

module.exports = function (RED) {

  function HTTPRequest(n) {
    RED.nodes.createNode(this, n);
    var node           = this;
    var nodeUrl        = n.url;
    var isTemplatedUrl = (nodeUrl || "").indexOf("{{") != -1;
    var nodeMethod     = "POST";
    
    this.messageType   = n.messageType;
    this.token         = n.token;
    this.device        = n.device;
    this.mode          = n.mode || "sync";
     
    
    
    
    if (n.tls) {
      var tlsNode = RED.nodes.getNode(n.tls);
    }
    this.ret = n.ret || "txt";
    if (RED.settings.httpRequestTimeout) {
      this.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || 120000;
    } else {
      this.reqTimeout = 120000;
    }

    this.on("input", function (msg) {
    
	// Check if the payload is a single message or multiple messages in an array, 
	// SCP IoT Service always expects and array, so wrap single messages in an array.
      var payload = {};
      payload["mode"] = n.mode || "sync";
      payload["messageType"] = n.messageType;
      payload["Authorization"] = "Bearer " + n.token;
      if (Object.prototype.toString.call(msg.payload) == '[object Array]') {
        payload["messages"] = msg.payload;
      } else {
        payload["messages"] = [];
        payload["messages"][0] = msg.payload;
      }  
        
      msg.payload = payload;
      
      var preRequestTimestamp = process.hrtime();
      node.status({
        fill: "blue",
        shape: "dot",
        text: "httpin.status.requesting"
      });

      var messageType	= n.messageType || msg.messageType;
      var token         = n.token || msg.token;
      var device        = n.device || msg.device;
      var mode          = n.mode || msg.mode || "sync";

      // concatenate URL with device ID
      var url 			= nodeUrl || msg.url;
      url 				= nodeUrl + device;
      
      if (msg.url && nodeUrl && (nodeUrl !== msg.url)) { // revert change below when warning is finally removed
        node.warn(RED._("common.errors.nooverride"));
      }
      if (isTemplatedUrl) {
        url = mustache.render(nodeUrl, msg);
      }
      if (!url) {
        node.error(RED._("httpin.errors.no-url"), msg);
        node.status({
          fill: "red",
          shape: "ring",
          text: (RED._("httpin.errors.no-url"))
        });
        return;
      }
      // url must start http:// or https:// so assume http:// if not set
      if (!((url.indexOf("http://") === 0) || (url.indexOf("https://") === 0))) {
        if (tlsNode) {
          url = "https://" + url;
        } else {
          url = "http://" + url;
        }
      }
	// Only post is accepted from the SCP IoT Service
      var method = nodeMethod.toUpperCase() || "POST";
      var opts = {
        method: method,
        url: url,
        timeout: node.reqTimeout,
        headers: {}
      };

      if (msg.headers) {
        for (var v in msg.headers) {
          if (msg.headers.hasOwnProperty(v)) {
            var name = v.toLowerCase();
            if (name !== "content-type" && name !== "content-length") {
              // only normalise the known headers used later in this
              // function. Otherwise leave them alone.
              name = v;
            }
            opts.headers[name] = msg.headers[v];
          }
        }
      }
    
    // Add the oAuth Token to the header
      opts.headers["Authorization"] = "Bearer " + n.token;
      
      if (msg.payload && (method == "POST" || method == "PUT" || method == "PATCH")) {
        if (opts.headers['content-type'] == 'application/x-www-form-urlencoded') {
          opts.form = msg.payload;
        } else {
          if (typeof msg.payload === "string" || Buffer.isBuffer(msg.payload)) {
            opts.body = msg.payload;
          } else if (typeof msg.payload == "number") {
            opts.body = msg.payload + "";
          } else {
            opts.body = JSON.stringify(msg.payload);
            if (opts.headers['content-type'] == null) {
              
              opts.headers['content-type'] = "application/json;charset=utf-8";
            }
          }
        }
      }

      if (this.credentials && this.credentials.user) {
        opts.auth = {
          user: this.credentials.user,
          pass: this.credentials.password,
          sendImmediately: false
        }
      }
      
      
      if (tlsNode) {
        tlsNode.addTLSOptions(opts);
      }
      msg["opts"] = opts;
      request(opts, function (error, response, body) {
        node.status({});
        if (error) {
          if (error.code === 'ETIMEDOUT') {
            node.error(RED._("common.notification.errors.no-response"), msg);
            setTimeout(function () {
              node.status({
                fill: "red",
                shape: "ring",
                text: "common.notification.errors.no-response"
              });
            }, 10);
          } else {
            node.error(error, msg);
            msg.payload = error.toString() + " : " + url;
            msg.statusCode = error.code;
            node.send(msg);
            node.status({
              fill: "red",
              shape: "ring",
              text: error.code
            });
          }
        } else {
          msg.payload = body;
          msg.headers = response.headers;
          msg.statusCode = response.statusCode;
          if (node.metric()) {
            // Calculate request time
            var diff = process.hrtime(preRequestTimestamp);
            var ms = diff[0] * 1e3 + diff[1] * 1e-6;
            var metricRequestDurationMillis = ms.toFixed(3);
            node.metric("duration.millis", msg, metricRequestDurationMillis);
            if (response.connection && response.connection.bytesRead) {
              node.metric("size.bytes", msg, response.connection.bytesRead);
            }
          }
          if (node.ret === "bin") {
            msg.payload = new Buffer(msg.payload, "binary");
          } else if (node.ret === "obj") {
            try {
              msg.payload = JSON.parse(msg.payload);
            } catch (e) {
              node.warn(RED._("httpin.errors.json-error"));
            }
          }
          node.send(msg);
        }
      })
    });
  }

  RED.nodes.registerType("scp-iot-http", HTTPRequest, {
    credentials: {
      user: {
        type: "text"
      },
      password: {
        type: "password"
      }
    },
    device: {
      type: "text"
    },
    token: {
      type: "text"
    },
    messageType: {
      type: "text"
    }
  });
}
