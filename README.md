# [Deltachaos](https://www.deltachaos.de/)

This is my personal home page. I am writing here about the current political situation, music, nerdstuff and whatever I
like.

If you have found a typo or you want to suggest a change please open a pull request.

## Development

### Setup

```bash
bundle install
```

### Running the development server

```bash
make dev
```

### Fetching Discogs Collection

To fetch your Discogs vinyl collection and update the `_data/collection.yaml` file:

1. Set your Discogs API token (username is read from `discogs_username` in `_config.yml`):
   ```bash
   export DISCOGS_TOKEN="your_discogs_api_token"
   ```

2. Run one of these commands:
   ```bash
   # Just fetch and build (no server)
   make fetch-discogs
   
   # Fetch and serve with development server
   make serve-with-fetch
   ```

The plugin will:
- Fetch all releases from your Discogs collection
- Download cover images to `assets/data/discogs/`
- Save the collection data to `_data/collection.yaml`
- Sort releases by date added (newest first)
