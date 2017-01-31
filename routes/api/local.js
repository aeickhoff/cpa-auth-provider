"use strict";

var db = require('../../models');
var config = require('../../config');
var requestHelper = require('../../lib/request-helper');
var jwtHelpers = require('../../lib/jwt-helper');

var bcrypt = require('bcrypt');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var recaptcha = require('express-recaptcha');

var jwt = require('jwt-simple');
var JwtStrategy = require('passport-jwt').Strategy;
var cors = require('../../lib/cors');

var emailHelper = require('../../lib/email-helper');
var authHelper = require('../../lib/auth-helper');


var INCORRECT_LOGIN_OR_PASS = 'The user name or password is incorrect';

// Google reCAPTCHA
recaptcha.init(config.recaptcha.site_key, config.recaptcha.secret_key);

var opts = {};
opts.secretOrKey = config.jwtSecret;
passport.use(new JwtStrategy(opts, function (jwt_payload, done) {
    if (!jwt_payload) {
        done(null, false);
        return;
    }
    db.User.findOne({where: {id: jwt_payload.id}})
        .then(function (user) {
            if (user) {
                done(null, user);
            } else {
                done(null, false);
            }
        });
}));


module.exports = function (app, options) {
    app.post('/api/local/signup', cors, recaptcha.middleware.verify, function (req, res) {

        if (req.recaptcha.error) {
            res.json({success: false, msg: 'Something went wrong with the reCAPTCHA'});
            return;
        }

        if (!req.body.email || !req.body.password) {
            res.json({success: false, msg: 'Please pass email and password.'});
        } else {
            db.User.findOne({where: {email: req.body.email}})
                .then(function (user) {
                    if (user) {
                        return res.status(400).json({success: false, msg: 'email already exists.'});
                    } else {
                        db.sequelize.sync().then(function () {
                            var user = db.User.create({
                                email: req.body.email,
                            }).then(function (user) {
                                    user.setPassword(req.body.password);
                                    res.json({success: true, msg: 'Successfully created new user.'});
                                },
                                function (err) {
                                    res.status(500).json({success: false, msg: 'Oops, something went wrong :' + err});
                                });
                        });
                    }
                }, function (error) {
                    res.status(500).json({success: false, msg: 'Oops, something went wrong :' + error});
                });
        }
    });

    app.post('/api/local/authenticate', cors, function (req, res) {
        db.User.findOne({where: {email: req.body.email}})
            .then(function (user) {
                    if (!user) {
                        res.status(401).json({success: false, msg: INCORRECT_LOGIN_OR_PASS});
                        return;
                    }

                    user.verifyPassword(req.body.password).then(function (isMatch) {
                            if (isMatch) {
                                // if user is found and password is right create a token
                                var token = jwt.encode(user, config.jwtSecret);
                                // return the information including token as JSON
                                res.json({success: true, token: 'JWT ' + token});
                            } else {
                                res.status(401).json({success: false, msg: INCORRECT_LOGIN_OR_PASS});
                                return;
                            }
                        },
                        function (err) {
                            res.status(500).json({success: false, msg: 'Oops, something went wrong :' + err});
                        });
                },
                function (error) {
                    res.status(500).json({success: false, msg: 'Oops, something went wrong :' + error});
                });
    });

    // This is needed because when configuring a custom header JQuery automaticaly send options request to the server.
    // That following line avoid cross domain error like
    // XMLHttpRequest cannot load http://localhost.rts.ch:3000/api/local/info.
    // Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
    // Origin 'http://localhost.rts.ch:8090' is therefore not allowed access.
    app.options('/api/local/info', cors);

    app.get('/api/local/info', cors, passport.authenticate('jwt', {session: false}), function (req, res) {
        var token = jwtHelpers.getToken(req.headers);
        if (token) {
            var decoded = jwt.decode(token, config.jwtSecret);
            db.User.findOne({
                where: {
                    id: decoded.id
                }
            }).then(function (user) {
                if (!user) {
                    return res.status(403).send({success: false, msg: INCORRECT_LOGIN_OR_PASS});
                } else {

                    db.UserProfile.findOrCreate({
                        where: {user_id: decoded.id}
                    }).spread(function (user_profile) {
                        res.json({
                            success: true,
                            user: {
                                email: user.email,
                                display_name: user_profile.getDisplayName(user, req.query.policy),
                                admin: user.admin
                            },
                            token: 'JWT ' + token
                        });
                    });

                }
            });
        } else {
            return res.status(403).send({success: false, msg: 'No token provided.'});
        }
    });

    app.get('/api/local/request_verification_email', cors, passport.authenticate('jwt', {session: false}), function (req, res) {

        var user = authHelper.getAuthenticatedUser(req);

        if (!user) {
            return res.status(403).send({success: false, msg: "not authenticated"});
        } else {
            emailHelper.send(config.mail.from, user.email, "validation-email", {log: false}, {
                host: config.mail.host,
                mail: encodeURIComponent(user.email),
                code: encodeURIComponent(user.verificationCode)
            }, config.mail.local, function () {
            });
            return res.status(204).send({success: true, msg: "email sent"});
        }

    });
};

