var express = require('express'),
    everyauth = require('everyauth'),
    qs = require('querystring'),
    url = require('url'),
    rk = require('node-runkeeper/lib/runkeeper'),
    RedisStore = require('connect-redis')(express);

var runKeeper = new rk.HealthGraph({
  client_id : process.env.RUNKEEPER_KEY,
  client_secret : process.env.RUNKEEPER_SECRET,
  auth_url : process.env.RUNKEEPER_AUTH_URL,
  access_token_url : process.env.RUNKEEPER_TOKEN_URL,
  redirect_uri : process.env.SERVER_URL + '/auth/runkeeper'
});

runKeeper.getAuthRedirect = function() {
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
  var runKeeper = req.session.auth ? req.session.auth.runKeeper : null,
      dropbox = req.session.auth ? req.session.auth.dropbox : null;
  res.render('index', {
    locals: {
      title: 'RunBoxer',
      hasRunKeeper: runKeeper != null,
      runKeeper: runKeeper,
      hasDropbox: dropbox != null,
      dropbox: dropbox,
    }
  });
});

app.get('/auth/:service/logout', function(req, res) {
  if (req.params.service in { 'runkeeper':1, 'dropbox': 1}) {
    if (req.session.auth[req.params.service]) {
      delete req.session.auth[req.params.service];
    }
  }
  res.redirect('/');
})

app.get('/auth/runkeeper', function(req,res){
  if (req.session.auth && req.session.auth.runKeeper) {
    res.redirect('/');
  } else if (req.query.code) {
    runKeeper.getNewToken(req.query.code, function(access_token) {
      req.session.auth = req.session.auth || {};
      req.session.auth.runKeeper = { access_token: access_token };
      // Get user profile information
      runKeeper.access_token = access_token;
      runKeeper.profile(function(data) {
        req.session.auth.runKeeper.user = JSON.parse(data);
        res.redirect('/')
      });
      runKeeper.access_token = null;
    })
  } else {
    res.redirect(runKeeper.getAuthRedirect());
  }
})

app.listen(process.env.PORT, function() {
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

