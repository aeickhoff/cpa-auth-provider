"use strict";
var passport = require('passport');
var cors = require('cors');
var logger = require('../../lib/logger');
var deleteHelper = require('../../lib/user-deletion');

module.exports = setup;

function setup(router) {
    var cors_headers = cors({origin: true, methods: ['DELETE']});

    router.options('/oauth2/me', cors_headers);
    var deleteRequest = [
        passport.authenticate('bearer', {session: false}),
        scheduleDeleteUser
    ];
    router.delete('/oauth2/me', cors_headers, deleteRequest);
}

function scheduleDeleteUser(req, res, next) {
    logger.warn('[OAuth2][delete me scheduled][user_id', req.user ? req.user.id : '', ']');

    if (!req.body.password) {
        return res.status(400).json({msg: 'PASSWORD_REQUIRED', success: false});
    }

    req.user.verifyPassword(req.body.password).then(
        function (correct) {
            if (correct) {
                deleteHelper.scheduleForDeletion(req.user, req.authInfo.client).then(
                    function (m) {
                        return res.status(202).json({msg: m.msg, t: m.t, success: true});
                    },
                    function (e) {
                        return res.status(400).json({msg: e.message, success: false});
                    }
                );
            } else {
                return res.status(400).json({msg: 'WRONG_PASSWORD', success: false});
            }
        }
    );

}