Assuming you have node, npm and the Heroku tools (foreman mainly).

Go to http://runkeeper.com/partner/applications to set up a RunKeeper application.

Go to https://www.dropbox.com/developers to set up a Dropbox application.

Do `npm install`.

Add the following keys to a `.env` file to run locally:

```
DROPBOX_KEY=???
DROPBOX_SECRET=???
RUNKEEPER_KEY=???
RUNKEEPER_SECRET=???
RUNKEEPER_AUTH_URL=???
RUNKEEPER_TOKEN_URL=???
RUNKEEPER_REMOVE_URL=???
SESSION_SECRET=???
SERVER_URL=???
REDISTOGO_URL=???
```

Type `foreman start`.

Add these vars using `heroku config:add FOO=???` if you want to push to Heroku.

Without RunKeeper's approval this app will only run for the owner of the RunKeeper
API keys. Talk to RunKeeper if you want to adapt it for another purpose and open it
up to the public. Be sure to add a privacy policy etc.

This app originally used bits of https://github.com/evnm/dropbox-node and 
https://github.com/marksoper/node-runkeeper but is now more self-contained. Thanks
to the authors of those libraries for informing this one.

MIT licensed.
