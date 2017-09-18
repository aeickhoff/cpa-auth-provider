"use strict";
var db = require('../models');
var config = require('../config');
var sendEmail = require('./send-email');

module.exports = {
    deleteExpiredUsers: deleteExpiredUsers,
    cancelDeletion: cancelDeletion,
    scheduleForDeletion: scheduleForDeletion,
    start: start,
    stop: stop,
};

var DELETION_CONF = config.deletion || {};
var DELAY_DELETION_DAYS = DELETION_CONF.delay_in_days || 7;
var TIMEOUT = DELETION_CONF.delete_interval || 6 * 60 * 60;
var VERIFICATION_TIME = DELETION_CONF.verification_time || 48 * 60 * 60;

function scheduleForDeletion(user, client) {
    return new Promise(
        function (resolve, reject) {
            if (user.scheduled_for_deletion_at) {
                return resolve({msg: 'ALREADY_SCHEDULED', t: user.scheduled_for_deletion_at});
            }

            var deletionTime = new Date();
            deletionTime.setHours(deletionTime.getHours() + DELAY_DELETION_DAYS * 24);
            user.updateAttributes({scheduled_for_deletion_at: deletionTime}).then(
                function () {
                    var emailSent = user.verified;
                    if (emailSent) {
                        var link = client ? client.email_redirect_uri || client.redirect_uri : '';
                        sendEmail.sendDeleteNotification(user.email, link).then(
                            function () {
                            },
                            function (e) {
                                console.log(e);
                            }
                        );
                    }
                    return resolve({msg: 'SCHEDULED', t: user.scheduled_for_deletion_at, email_sent: emailSent});
                }
            ).catch(reject);
        }
    );
}

function cancelDeletion(user, client) {
    return new Promise(
        function (resolve, reject) {
            if (!user.scheduled_for_deletion_at) {
                return resolve(false);
            }

            user.updateAttributes({scheduled_for_deletion_at: null}).then(
                function () {
                    var emailSent = user.verified;
                    if (emailSent) {
                        var link = client ? client.email_redirect_uri || client.redirect_uri : '';
                        sendEmail.sendDeleteCanceledNotification(user.email, link).then(
                            function () {
                            },
                            function (e) {
                                console.log(e);
                            }
                        );
                    }
                    return resolve(true);
                }
            ).catch(reject);
        }
    );
}


function deleteExpiredUsers() {
    return new Promise(
        function (resolve, reject) {
            db.User.destroy(
                {
                    where: {
                        scheduled_for_deletion_at: {
                            $lt: new Date()
                        }
                    }
                }
            ).then(
                resolve,
                reject
            )
        }
    );
}

function deleteVerificationFailUsers() {
    return new Promise(
        function (resolve, reject) {
            var verificationRequiredDate = new Date();
            verificationRequiredDate.setSeconds(verificationRequiredDate.getSeconds() - VERIFICATION_TIME);
            db.User.destroy(
                {
                    where: {
                        created_at: {$lt: verificationRequiredDate},
                        verified: {$not: true}
                    }
                }
            ).then(resolve, reject);
        }
    )
}

var activeInterval = 0;

function cycle() {
    if (TIMEOUT <= 0) {
        return;
    }

    deleteExpiredUsers().then(
        function (count) {
            console.log('[DELETE][Requested Deletions][amount', count, ']');
        },
        function (e) {
            console.log('[DELETE][Requested Deletions][error', e, ']');
        }
    );
    deleteVerificationFailUsers().then(
        function (count) {
            console.log('[DELETE][Verification Fail][amount', count, ']');
        },
        function (e) {
            console.log('[DELETE][Verification Fail][error', e, ']');
        }
    );

    activeInterval = setTimeout(
        cycle,
        TIMEOUT * 1000
    );
}

function start() {
    if (activeInterval) {
        return;
    }
    cycle();
}

function stop() {
    if (!activeInterval) {
        return;
    }
    clearTimeout(activeInterval);
    activeInterval = 0;
}