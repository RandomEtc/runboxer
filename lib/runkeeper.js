/*jshint node:true globalstrict:true*/
"use strict";

var request = require('request'),
    qs = require('querystring');

function RunKeeper(options) {
    this.client_id = options.client_id;
    this.client_secret = options.client_secret;
    this.auth_url = options.auth_url;
    this.access_token_url = options.access_token_url;
    this.redirect_uri = options.redirect_uri;
    this.api_domain = options.api_domain;
}

RunKeeper.prototype.request = function(request_details, callback) {
    request(request_details, function(error, response, body) {
        if (error) {
            return callback(error);
        }
        try {
            var data = JSON.parse(body);
            callback(null, data);
        } catch(err) {
            callback(err);
        }
    });
};

RunKeeper.prototype.get = function(uri, media_type, access_token, callback) {
    this.request({
        method: 'GET',
        headers: {
            'Accept': media_type, // TODO: how to know?
            'Authorization': 'Bearer ' + access_token
        },
        uri: "https://" + this.api_domain + uri
    }, callback);
};

RunKeeper.prototype.getAccessToken = function(authorization_code, callback) {

    var request_params = {
        grant_type: "authorization_code",
        code: authorization_code,
        client_id: this.client_id,
        client_secret: this.client_secret,
        redirect_uri: this.redirect_uri
    };

    var request_details = {
        method: "POST",
        headers: { 'content-type' : 'application/x-www-form-urlencoded' },
        uri: this.access_token_url,
        body: qs.stringify(request_params)
    };

    this.request(request_details, callback);
};

RunKeeper.prototype.getAuthRedirect = function() {
    var query = {
        client_id: this.client_id,
        response_type: 'code',
        redirect_uri: this.redirect_uri
    };
    return this.auth_url + '?' + qs.stringify(query);
};

RunKeeper.prototype.authRoute = function() {
    var runkeeper = this;
    return function(req,res,next){
        if (req.session.auth && req.session.auth.runkeeper) {
            res.redirect('/');
        } else if (req.query.code) {
            runkeeper.getAccessToken(req.query.code, function(err, data) {
                if (err) {
                    return next(err);
                }
                console.log("got access_token %s", data);
                req.session.auth = req.session.auth || {};
                req.session.auth.runkeeper = data;
                // Get user resource information:
                var uri = '/user',
                    accept = 'application/vnd.com.runkeeper.User+json';
                runkeeper.get(uri, accept, data.access_token, function(err, user) {
                    if (err) {
                        delete req.session.auth.runkeeper;
                        return next(err);
                    }
                    req.session.auth.runkeeper.user = user;
                    // get actual profile info
                    var uri = user.profile,
                        accept = 'application/vnd.com.runkeeper.Profile+json';
                    runkeeper.get(uri, accept, data.access_token, function(err, profile) {
                        if (err) {
                            delete req.session.auth.runkeeper;
                            return next(err);
                        }
                        req.session.auth.runkeeper.profile = profile;
                        res.redirect('/');
                    });
                });
            });
        } else {
          res.redirect(runkeeper.getAuthRedirect());
        }
    };
};

RunKeeper.prototype.userRoute = function() {
    var runkeeper = this;
    return function(req,res,next){
        var uri = '/user',
            accept = 'application/vnd.com.runkeeper.User+json',
            token = req.runkeeper.access_token;
        runkeeper.get(uri, accept, token, function(err,data) {
            if (err) {
                return next(err);
            }
            res.send(data);
        });
    };
};

RunKeeper.prototype.profileRoute = function() {
    var runkeeper = this;
    return function(req, res, next){
        var uri = req.runkeeper.user.profile,
            accept = 'application/vnd.com.runkeeper.Profile+json',
            token = req.runkeeper.access_token;
        runkeeper.get(uri, accept, token, function(err,data) {
            if (err) {
                return next(err);
            }
            res.send(data);
        });
    };
};

RunKeeper.prototype.fitnessActivityFeedRoute = function() {
    var runkeeper = this;
    return function(req, res, next) {
        var uri = req.runkeeper.user.fitness_activities,
            accept = 'application/vnd.com.runkeeper.FitnessActivityFeed+json',
            token = req.runkeeper.access_token;
        runkeeper.get(uri, accept, token, function(err,data) {
            if (err) {
                return next(err);
            }
            console.log(data);
            res.send(data);
        });
    };
};


module.exports = RunKeeper;
