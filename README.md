# Follower Counter

Your Bluesky or Mastodon follower count, live on your BUSY Bar.

A JavaScript app for [BUSY Bar](https://busy.app). Work in progress.

## What it does

- The front display shows the network's logo, the count in large digits and today's change, such as `+12 today`.
- The wheel switches between followers, following and posts.
- Every round number (you choose the step) sets off fireworks across the screen, with a sound and the status light.
- The back display shows the daily change and a small chart from the history the app keeps.
- Settings: network, handle, the step for the celebration.

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
