"use strict";

var db = require('../../models/index');
var logger = require('../../lib/logger');
var cors = require('cors');
var authHelper = require('../../lib/auth-helper');
var passport = require('passport');
var emailHelper = require('../../lib/email-helper');
var config = require('../../config');
var uuid = require('node-uuid');

var STATES = {
    INVALID_TOKEN: 'INVALID_TOKEN',
    MISMATCHED_CLIENT_ID: 'MISMATCHED_CLIENT_ID',
    ALREADY_USED: 'ALREADY_USED',
    EMAIL_ALREADY_TAKEN: 'EMAIL_ALREADY_TAKEN',
};

module.exports = routes;

var APPEND_MOVED = '?auth=account_moved';

function routes(router) {
    router.options('/email/change', cors());
    router.post(
        '/email/change',
        cors(),
        passport.authenticate('bearer', {session: false}),
        // authHelper.ensureAuthenticated,
        function (req, res) {
            var oldUser = req.user;
            var newUsername = req.body.new_email;
            var password = req.body.password;

            if (!oldUser) {
                console.log('[POST /email/change][FAIL][user_id ][from ][to', newUsername, ']');
                console.log(oldUser);
                return res.status(401).json({success: false, reason: 'Unauthorized'})
            }
            console.log('[POST /email/change][user_id', oldUser.id, '][from',
                oldUser.email, '][to', newUsername, ']');

            db.User.findOne({where: {email: newUsername}}).then(
                function (user) {
                    if (user) {
                        throw new Error(STATES.EMAIL_ALREADY_TAKEN);
                    }
                    return oldUser.verifyPassword(password);
                }
            ).then(
                function (correct) {
                    if (!correct) {
                        logger.warn('[POST /email/change][FAIL bad password][user_id', oldUser.id, '][from',
                            oldUser.email, '][to', newUsername, ']');
                        return res.status(403).json({success: false, reason: 'Forbidden'});
                    }

                    logger.debug('[POST /email/change][SUCCESS][user_id', oldUser.id, '][from',
                        oldUser.email, '][to', newUsername, ']');
                    triggerAccountChangeEmails(oldUser, req.authInfo.client, newUsername);
                    return res.status(200).json({success: true});
                }
            ).catch(
                function (err) {
                    logger.warn('[POST /email/change][FAIL bad password][user_id', oldUser.id, '][from',
                        oldUser.email, '][to', newUsername, '][err', err, ']');
                    return res.status(400).json({success: false, reason: err.message});
                }
            );
        }
    );

    router.get(
        '/email/move/:token',
        function (req, res) {
            var user, token;
            var clientId, oldEmail, newUsername;
            db.UserEmailToken.findOne({where: {key: req.params.token}, include: [db.User, db.OAuth2Client]}).then(
                function (token_) {
                    token = token_;
                    clientId = req.query.client_id;
                    if (!token || !token.type.startsWith('MOV')) {
                        throw new Error(STATES.INVALID_TOKEN);
                    }

                    if (token.OAuth2Client.client_id !== clientId) {
                        throw new Error(STATES.MISMATCHED_CLIENT_ID);
                    }

                    user = token.User;
                    oldEmail = user.email;
                    newUsername = token.type.split('$')[1];
                    if (!token.isAvailable()) {
                        var err = new Error(STATES.ALREADY_USED);
                        err.data = {success: newUsername === oldEmail};
                        throw err;
                    }


                    return db.User.findOne({where: {email: newUsername}});
                }
            ).then(
                function (takenUser) {
                    if (takenUser) {
                        throw new Error(STATES.EMAIL_ALREADY_TAKEN);
                    }
                    return user.updateAttributes({
                        email: newUsername
                    });
                }
            ).then(
                function () {
                    return token.consume();
                }
            ).then(
                function () {
                    return redirectOnSuccess(undefined);
                }
            ).catch(
                function (err) {
                    logger.error('[GET /email/move/:token][FAIL][old', oldEmail, '][new', newUsername, '][user.id', user ? user.id : null, '][err', err, ']');
                    if (err.data && err.data.success) {
                        return redirectOnSuccess(err.message);
                    } else {
                        return res.status(400).json({success: false, reason: err.message});
                    }
                }
            );

            function redirectOnSuccess(message) {
                var fields = [
                    'username=' + encodeURIComponent(user.email),
                    'old=' + encodeURIComponent(oldEmail)
                ];
                if (message) {
                    fields.push('message=' + encodeURIComponent(message));
                }
                return res.redirect(token.OAuth2Client.email_redirect_url + APPEND_MOVED + '&' + fields.join('&'));
            }
        }
    );

    router.options('/email/moved/:token', cors());
    router.get(
        '/email/moved/:token',
        cors(),
        function (req, res) {
            var user, token;
            var clientId, oldEmail, newUsername;
            db.UserEmailToken.findOne({where: {key: req.params.token}, include: [db.User, db.OAuth2Client]}).then(
                function (token_) {
                    token = token_;
                    clientId = req.query.client_id;
                    if (!token || !token.type.startsWith('MOV')) {
                        throw new Error(STATES.INVALID_TOKEN);
                    }

                    if (token.OAuth2Client.client_id !== clientId) {
                        throw new Error(STATES.MISMATCHED_CLIENT_ID);
                    }

                    user = token.User;
                    oldEmail = user.email;
                    newUsername = token.type.split('$')[1];

                    if (!token.isAvailable()) {
                        var err = new Error(STATES.ALREADY_USED);
                        err.data = {success: oldEmail === newUsername};
                        throw err;
                    }


                    return db.User.findOne({where: {email: newUsername}});
                }
            ).then(
                function (takenUser) {
                    if (takenUser) {
                        throw new Error(STATES.EMAIL_ALREADY_TAKEN);
                    }
                    return user.updateAttributes({
                        email: newUsername
                    });
                }
            ).then(
                function () {
                    return token.consume();
                }
            ).then(
                function () {
                    return res.status(200).json({success: true})
                }
            ).catch(
                function (err) {
                    logger.error('[GET /email/moved/:token][FAIL][old', oldEmail, '][new', newUsername, '][user.id', user ? user.id : null, '][err', err, ']');
                    if (err.data && err.data.success) {
                        return res.status(200).json({success: true, reason: err.message});
                    } else {
                        return res.status(400).json({success: false, reason: err.message});
                    }
                }
            );
        }
    );
}

function triggerAccountChangeEmails(user, client, newUsername) {
    return new Promise(
        function (resolve, reject) {
            if (!client) {
                return reject('UNKNOWN_CLIENT');
            }

            var redirectUri = client.email_redirect_uri;
            if (!client.mayEmailRedirect(redirectUri)) {
                redirectUri = undefined;
            }

            var baseUid = uuid.v4();
            var key = new Buffer(uuid.parse(baseUid)).toString('base64');

            db.UserEmailToken.create({
                key: key,
                type: 'MOV$' + newUsername,
                user_id: user.id,
                redirect_uri: redirectUri,
                oauth2_client_id: client ? client.id : undefined
            }).then(
                function (verifyToken) {
                    var confirmLink = host + '/email/move/' + encodeURIComponent(key);
                    if (redirectUri) {
                        confirmLink = redirectUri + '?auth=account_moved&username=' + encodeURIComponent(user.email) + '&token=' + encodeURIComponent(key);
                    }
                    console.log('send email', confirmLink);
                    return emailHelper.send(
                        config.mail.from,
                        newUsername,
                        "email-change-validation",
                        {},
                        {
                            oldEmail: user.email,
                            newEmail: newUsername,
                            confirmLink: confirmLink
                        }
                    );
                }
            ).then(
                function () {
                    if (user.verified) {
                        return emailHelper.send(
                            config.mail.from,
                            user.email,
                            'email-change-information',
                            {},
                            {
                                oldEmail: user.email,
                                newEmail: newUsername
                            }
                        );
                    } else {
                        return new Promise(
                            function (resolve, reject) {
                                return resolve();
                            }
                        );
                    }
                }
            ).then(
                function () {
                    resolve();
                }
            ).catch(
                reject
            );

        }
    );
}