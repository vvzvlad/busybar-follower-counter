# Follower Counter

Your Bluesky or Mastodon follower count, live on your BUSY Bar.

A JavaScript app for [BUSY Bar](https://busy.app). Work in progress.

## What it does

- The front display shows the network's pixel logo (the Bluesky butterfly or the Mastodon "m") and the count in large digits; on the followers view today's gain takes the place of the word, such as `+12 TODAY`.
- The wheel switches between followers, following and posts.
- When your followers pass a round number (a multiple of the step you set, 100 by default), fireworks go off across the screen, with a sound and the status light.
- The back display shows the followers, today's gain and a chart of the last 24 hours from the history the app keeps.
- Without a connection the last counts stay, dimmed, with a red cross.
- Settings: network, handle, the step for the fireworks.

## Data

The public Bluesky and Mastodon APIs, no keys needed.

## Build

Node 24 and npm:

```sh
npm ci
npm run build         # dist/io.github.vvzvlad.followers.tgz
npm run app:install   # install it on a BUSY Bar connected over USB
npm run app:run       # start it
```

## License

[MIT](LICENSE)
