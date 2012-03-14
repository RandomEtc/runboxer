/*jshint node:true globalstrict:true*/
"use strict";

var request = require('request'),
    everyauth = require('everyauth');

function Dropbox(options) {
    this.consumerKey = options.consumerKey;
    this.consumerSecret = options.consumerSecret;
    this.api = options.api || 'https://api.dropbox.com/1';
    this.contentApi = options.contentApi || 'https://api-content.dropbox.com/1';
    this.sandbox = Boolean(options.sandbox);

    everyauth.dropbox
        .myHostname(options.hostName)
        .consumerKey(this.consumerKey)
        .consumerSecret(this.consumerSecret)
        .findOrCreateUser( function (sess, accessToken, accessSecret, user) {
            // session based only, for now
            return user;
        })
        .redirectPath('/');
}

Dropbox.prototype.filesPut = function(path, contents, media_type, auth, callback) {
    var url = this.contentApi + '/files_put/' + (this.sandbox ? 'sandbox' : 'dropbox') + path,
        oauth = {
            consumer_key: this.consumerKey,
            consumer_secret: this.consumerSecret,
            token: auth.accessToken,
            token_secret: auth.accessTokenSecret
        };
    request.put({ url:url, oauth:oauth, body:contents, json:true }, function (err, res, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, data);
        }
    });
};

module.exports = Dropbox;
