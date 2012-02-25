var express = require('express'),
    everyauth = require('everyauth'),
    qs = require('querystring'),
    url = require('url'),
    rk = require('node-runkeeper/lib/runkeeper'),
    OAuth = require('oauth').OAuth,
    RedisStore = require('connect-redis')(express);

var API_URI = 'https://api.dropbox.com/1'
  , CONTENT_API_URI = 'https://api-content.dropbox.com/1';

var dropbox = new OAuth(API_URI + '/oauth/request_token'
                    , API_URI + '/oauth/access_token'
                   , process.env.DROPBOX_KEY, process.env.DROPBOX_SECRET
                           , '1.0', null, 'HMAC-SHA1');

var runkeeper = new rk.HealthGraph({
  client_id : process.env.RUNKEEPER_KEY,
  client_secret : process.env.RUNKEEPER_SECRET,
  auth_url : process.env.RUNKEEPER_AUTH_URL,
  access_token_url : process.env.RUNKEEPER_TOKEN_URL,
  redirect_uri : process.env.SERVER_URL + '/auth/runkeeper'
});

runkeeper.getAuthRedirect = function() {
  var query = {
    client_id: this.client_id,
    response_type: 'code',
    redirect_uri: this.redirect_uri
  }
  return this.auth_url + '?' + qs.stringify(query);
}

//everyauth.debug = true;

everyauth.dropbox
  .myHostname(process.env.SERVER_URL)
  .consumerKey(process.env.DROPBOX_KEY)
  .consumerSecret(process.env.DROPBOX_SECRET)
  .findOrCreateUser( function (sess, accessToken, accessSecret, user) {
    // session based only, for now
    return user;
  })
  .redirectPath('/');

var app = express.createServer();

// Configuration

var redisUrl = url.parse(process.env.REDISTOGO_URL),
    redisOptions = {
      port: redisUrl.port,
      host: redisUrl.hostname,
      pass: redisUrl.auth && redisUrl.auth.split(":")[1] // just the password
    };

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(express.session({ store: new RedisStore(redisOptions), secret: process.env.SESSION_SECRET }));
  app.use(everyauth.middleware());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', function(req,res){
  var runkeeperAuth = req.session.auth ? req.session.auth.runkeeper : null,
      dropboxAuth = req.session.auth ? req.session.auth.dropbox : null;
  res.render('index', {
    locals: {
      title: 'RunBoxer',
      hasRunKeeper: runkeeperAuth != null,
      runkeeper: runkeeperAuth,
      hasDropbox: dropboxAuth != null,
      dropbox: dropboxAuth,
    }
  });
});

function requireRunKeeper(req,res,next) {
  var runkeeperAuth = req.session.auth && req.session.auth.runkeeper;
  if (runkeeperAuth) {
    req.runkeeper = runkeeperAuth;
    next();
  } else {
    res.send("RunKeeper needs authorizing first.", 403);
  }
}

app.get('/test/runkeeper', requireRunKeeper, function(req,res){
  runkeeper.access_token = req.runkeeper.access_token;
  runkeeper.profile(function(data) {
    res.send(data);
  });
  runkeeper.access_token = null;
});

app.get('/api/runkeeper/fitness-activities', requireRunKeeper, function(req, res) {
  runkeeper.access_token = req.runkeeper.access_token;
  runkeeper.fitnessActivityFeed(function(data) {
    res.send(data);
  });
  runkeeper.access_token = null;
})

function requireDropbox(req,res,next) {
  var dropboxAuth = req.session.auth && req.session.auth.dropbox;
  if (dropboxAuth) {
    req.dropbox = dropboxAuth;
    next();
  } else {
    res.send("Dropbox needs authorizing first.", 403);
  }
}

app.get('/test/dropbox', requireDropbox, function(req,res){
  dropbox.put(CONTENT_API_URI + '/files_put/sandbox/' + 'test.txt'
                    , req.dropbox.accessToken
                    , req.dropbox.accessTokenSecret
                    , 'I am a test.', "text/plain"
                    , function(err, data, rsp) {
                        if (err) {
                          console.error(err);
                          res.send('oauth client error',500);
                        } else {
                          res.send(JSON.parse(data));
                        }
                    });
})

app.get('/auth/:service/logout', function(req, res) {
  var service = req.params.service;
  console.log('attempting to remove %s', service)
  if (service in { 'runkeeper':1, 'dropbox': 1}) {
    if (req.session.auth && req.session.auth[service]) {
      delete req.session.auth[service];
    } else {
      console.error('%s service not logged in', service)
    }
  } else {
    console.error('%s not a valid service for logout', service)
  }
  res.redirect('/');
})

app.get('/auth/runkeeper', function(req,res){
  if (req.session.auth && req.session.auth.runkeeper) {
    res.redirect('/');
  } else if (req.query.code) {
    runkeeper.getNewToken(req.query.code, function(access_token) {
      req.session.auth = req.session.auth || {};
      req.session.auth.runkeeper = { access_token: access_token };
      // Get user profile information
      runkeeper.access_token = access_token;
      runkeeper.profile(function(data) {
        req.session.auth.runkeeper.user = JSON.parse(data);
        res.redirect('/')
      });
      runkeeper.access_token = null;
    })
  } else {
    res.redirect(runkeeper.getAuthRedirect());
  }
})

app.listen(process.env.PORT, function() {
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

