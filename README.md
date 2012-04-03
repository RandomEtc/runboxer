# Wat

A simple proof of concept app that connects to your RunKeeper account and your Dropbox 
account and saves a copy of all your RunKeeper logs as a KML file to be viewed in 
Google Earth. The KML template needs work :)

## Requirements

You need node, npm and the Heroku tools (well, foreman) and a local install of redis.

## Installation

Clone this repository. Do `npm install`.

Add the following keys to a `.env` file to run locally:

```
# go to https://www.dropbox.com/developers to set up a Dropbox application
DROPBOX_KEY=???
DROPBOX_SECRET=???

# go to http://runkeeper.com/partner/applications to set up a RunKeeper application
RUNKEEPER_KEY=???
RUNKEEPER_SECRET=???

# make sure to put some random stuff in here
SESSION_SECRET=???

# be sure to set this to whatever you're using
SERVER_URL=http://localhost:5000

# this is the Redis default, you'll need to run Redis locally
REDISTOGO_URL=redis://localhost:6379

# these are env vars for good hygeine but shouldn't need editing
RUNKEEPER_AUTH_URL=https://runkeeper.com/apps/authorize
RUNKEEPER_TOKEN_URL=https://runkeeper.com/apps/token
RUNKEEPER_REMOVE_URL=https://runboxer.herokuapp.com/api/runkeeper/auth/remove
```

Type `foreman start`.

Add these vars using `heroku config:add FOO=???` if you want to push to Heroku.

## Caveats

Without RunKeeper's approval this app will only run for the owner of the RunKeeper
API keys. Talk to RunKeeper if you want to adapt it for another purpose and open it
up to the public. Be sure to add a privacy policy etc.

## Acknowledgements

This app originally used bits of https://github.com/evnm/dropbox-node and 
https://github.com/marksoper/node-runkeeper but is now more self-contained. Thanks
to the authors of those libraries for informing this one.

## Legal

MIT licensed.
