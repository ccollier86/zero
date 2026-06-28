# Releasing Zero

Zero releases are explicit Git checkpoints with a package version, changelog
entry, commit, and tag.

## Version Bump

Use the version bump script for package metadata:

```txt
bun run version:bump -- 1.0.0
```

The script validates semver and updates `package.json`. It intentionally does
not create commits, tags, or changelog entries.

## Release Checklist

1. Update `CHANGELOG.md` with the release date and notable changes.
2. Run verification:

```txt
bun run typecheck
bun test
bun run build
git diff --check
```

3. Commit the release:

```txt
git add -A
git commit -m "chore: release zero platform 1.0.0"
```

4. Tag the release:

```txt
git tag -a v1.0.0 -m "Zero Platform 1.0.0"
```

Push the commit and tag together when publishing the release.
