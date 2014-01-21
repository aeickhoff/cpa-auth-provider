"use strict";

var db = require('../models');
var generate = require('../lib/generate');
var requestHelper = require('../lib/request-helper');
var verify = require('../lib/verify');
var config = require('../config');

module.exports = function(app) {
  var logger = app.get('logger');

  // Client Registration Endpoint
  // http://tools.ietf.org/html/draft-ietf-oauth-dyn-reg-14#section-3

  app.post('/register', function(req, res) {
    if (!requestHelper.isContentType(req, 'application/json')) {
      logger.error("Invalid content type:", req.get('Content-Type'));
      res.json(400, { error: 'invalid_request' });
      return;
    }

    var clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    var clientSecret = generate.clientSecret(clientIp);

    //TODO: Check mandatory fields.

    var client = {
      id: null,
      secret: clientSecret,
      name: req.body.client_name,
      software_id: req.body.software_id,
      software_version: req.body.software_version,
      ip: clientIp
    };

    db.Client
      .create(client).complete(function(err, client) {
        if (err) {
          logger.error("Failed to create client:", err);

          // TODO: distinguish between invalid input parameters and other
          // failure conditions
          res.json(400, { error: 'invalid_request' });
          return;
        }

        var token = {
          token: generate.accessToken(),
          scope: '' // TODO: set scope as defined by service provider?
        };

        db.RegistrationAccessToken.create(token).complete(function(err, registrationAccessToken) {
          if (err) {
            logger.error("Failed to create registration access token:", err);
            res.json(400, { error: 'invalid_request' });
            return;
          }

          registrationAccessToken.setClient(client);

          res.json(201, {
            client_id: client.dataValues.id.toString(),
            client_secret: client.dataValues.secret,
            registration_access_token: registrationAccessToken.dataValues.token,
            registration_client_uri: config.uris.registration_client_uri
          });
        });
      });
  });

  // Client Configuration Endpoint
  // http://tools.ietf.org/html/draft-ietf-oauth-dyn-reg-14#section-4

  var configurationEndpoint = function(req, res, clientId) {
    if (!req.headers.authorization) {
      // RFC6750: http://tools.ietf.org/html/rfc6750#section-3.1 : request lacks any auth information
      res.setHeader('WWW-Authenticate', 'Bearer realm="' + config.realm + '"');
      res.json(401, { error: 'unauthorized' });
      return;
    }

    verify.registrationAccessToken(req.headers.authorization, clientId, function(err, registrationAccessToken, client) {
      if (err || !registrationAccessToken || !client) {
        // RFC6750: http://tools.ietf.org/html/rfc6750#section-3.1
        res.setHeader('WWW-Authenticate', 'Bearer realm="' + config.realm + '",\nerror="invalid_token",\nerror_description="Unknown or expired token"');
        res.json(401, { error: 'unauthorized' });
        return;
      }

      res.json({
        client_id: client.dataValues.id.toString(),
        client_secret: client.dataValues.secret,
        registration_access_token: registrationAccessToken.dataValues.token,
        registration_client_uri: config.uris.registration_client_uri
      });
    });
  };

  //Client_id is given in the path
  app.get('/register/:client_id', function(req, res) {
    var clientId = req.params.client_id;
    configurationEndpoint(req, res, clientId);
  });

  //Client_id is given as a GET Parameter
  app.get('/register', function(req, res) {
    var clientId = req.query.client_id;
    configurationEndpoint(req, res, clientId);
  });

  app.put('/register', function(req, res) {
    res.send(501);
  });

  app.delete('/register', function(req, res) {
    res.send(501);
  });
};
