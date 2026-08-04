her name is `skullicita` and she is my lil assistant <3

## capabilities

- 📅 gcal read/write via google service account
- ☀️ uv + cloud cover + sunset forecast via [open-meteo](https://open-meteo.com)
- 📖 reading progress with storygraph via [storygraph-wrapper](https://github.com/BrunoJurkovic/storygraph-wrapper) 

check them all out in 📁 [tools](/agent/tools/) and 📁 [skills](/agent/skills/)

## stack

[eve](https://eve.dev) agent deployed on [vercel](https://vercel.com) ▲

- model: `deepseek/deepseek-v4-pro` via [ai sdk](https://ai-sdk.dev), routed via [ai gateway](https://vercel.com/ai-gateway)
- eve channels: 
  - [photon](https://photon.codes) for imessage via [vercel connect](https://vercel.com/connect)
  - http for tui/deploy authenticated with [vercel oidc](https://vercel.com/docs/oidc)
- eve schedules: [cron jobs](https://vercel.com/docs/cron-jobs) for daily briefings
- eve sandbox: [vercel sandbox](https://vercel.com/sandbox) to run python
- preferences: stored privately as json in [vercel blob](https://vercel.com/docs/storage/vercel-blob)
