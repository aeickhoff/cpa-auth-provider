"use strict";

var url = require('url');

module.exports = {
  addQueryParameters: function(uri, parameters) {
    var u = url.parse(uri, true);
    if (!u.query) {
      u.query = {};
    }
    Object.keys(parameters).forEach(function(key) {
      u.query[key] = parameters[key];
    });
    u.search = null;
    return url.format(u);
  }
};
