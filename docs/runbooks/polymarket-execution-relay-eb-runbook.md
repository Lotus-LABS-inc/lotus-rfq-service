# Polymarket Execution Relay Elastic Beanstalk Runbook

This runbook is for deploying the Polymarket execution relay environment that backs `POLYMARKET_EXECUTION_RELAY_URL`.

## Invariants

- The EB relay must run the same backend commit, or a later commit, as the main backend execution code being tested.
- The EB relay must set `LOTUS_SERVICE_MODE=polymarket-execution-relay`.
- EB may run `npm start`; the backend entrypoint routes to the relay when `LOTUS_SERVICE_MODE` is set.
- Build source bundles with POSIX `/` paths. Do not use PowerShell `Compress-Archive` for EB relay bundles.
- Do not change `package.json` scripts only for EB. Keep the deploy artifact behavior controlled by `LOTUS_SERVICE_MODE`.
- Do not paste secrets, auth headers, raw signatures, or presigned log URLs into tickets or chat.

## Build Bundle

From the backend repo after `npm run build` passes:

```powershell
$commit=(git rev-parse --short HEAD).Trim()
$ts=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$label="relay-$commit-posix-$ts"
$stage=Join-Path $env:TEMP $label
$zip=Join-Path $env:TEMP "$label.zip"
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'dist') | Out-Null
Copy-Item -LiteralPath package.json -Destination $stage
Copy-Item -LiteralPath package-lock.json -Destination $stage
Copy-Item -LiteralPath 'dist\src' -Destination (Join-Path $stage 'dist') -Recurse
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
tar -a -cf $zip -C $stage .
tar -tf $zip | Select-String -Pattern '\\'
```

The final command must return no entries.

## Deploy

```powershell
$bucket='lotus-polymarket-relay-eb-271443695110-eu-west-1'
$key="releases/$label.zip"
aws s3 cp $zip "s3://$bucket/$key" --region eu-west-1
aws elasticbeanstalk create-application-version `
  --region eu-west-1 `
  --application-name lotus-polymarket-execution-relay `
  --version-label $label `
  --source-bundle S3Bucket=$bucket,S3Key=$key
aws elasticbeanstalk update-environment `
  --region eu-west-1 `
  --environment-name lotus-polymarket-relay-euw1c `
  --version-label $label `
  --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=LOTUS_SERVICE_MODE,Value=polymarket-execution-relay
```

## Verify

```powershell
aws elasticbeanstalk describe-environments `
  --region eu-west-1 `
  --environment-names lotus-polymarket-relay-euw1c `
  --query "Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,VersionLabel:VersionLabel}" `
  --output json

Invoke-RestMethod -Uri 'http://lotus-polymarket-relay-euw1c.eu-west-1.elasticbeanstalk.com/health'
Invoke-RestMethod -Uri 'http://lotus-polymarket-relay-euw1c.eu-west-1.elasticbeanstalk.com/readiness'
```

Expected:

- EB `Status` is `Ready`.
- EB `Health` is `Green`.
- `VersionLabel` includes the deployed commit short SHA.
- `/health` returns `service: polymarket-execution-relay`.
- `/readiness` returns relay readiness and `relaySecretConfigured: true`.
- Logs do not show `node dist/src/index.js` failing on main backend env requirements.
