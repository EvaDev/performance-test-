# Katana Configuration for Performance Testing

## Connection Limits

Katana has a default connection limit that can cause "Too many connections" (429) errors when running performance tests with many parallel transactions.

## Solution

We've created `katana.toml` with increased connection limits:

```toml
[server]
max_connections = 500
```

## Usage

To use the configuration file, start Katana with:

```bash
katana --dev --dev.no-fee --dev.accounts 500 --dev.seed 0 --block-time 100 --config katana.toml
```

Or use the start script which automatically uses the config:

```bash
./scripts/start-katana.sh 500 100
```

## Performance Impact

With `max_connections = 500`:
- Can handle 50-100 parallel transactions per batch (up from 20)
- Reduces "Too many connections" errors
- Improves throughput significantly

## Notes

- The config file is located at `katana.toml` in the project root
- If you don't specify `--config`, Katana uses default limits (~100 connections)
- Monitor Katana's performance after increasing limits

