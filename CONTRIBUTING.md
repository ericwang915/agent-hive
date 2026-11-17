# Contributing

Thanks for taking a look. Bug reports, small fixes and new engine adapters are all welcome.

## Run it

```bash
npm install
npm start
npm test
```

Set `HIVE_DATA=/some/dir` to use a throwaway state directory instead of your real one.

## How the code is laid out

There is no build step and no framework. The renderer is plain HTML, CSS and JS; the main process is one Electron file.

Logic that does not need Electron lives in `core.js`, `team.js`, `queen.js` and `garden.js`, and is covered by `test.js`. If you change behaviour there, add or update a test. UI changes do not need tests, but please include a screenshot in the pull request.

## Adding an engine

An engine is an entry in `ENGINES` in `core.js`: a label, the command name, an optional model list, and an `args(agent, prompt, ctx)` function that returns the argument array. Arguments are always passed as an array, never through a shell.

If the CLI prints JSON lines, teach `makeParser` in `core.js` to read them and add a case to the parser tests. If it prints plain text, nothing else is needed: plain lines are shown as the reply.

## Pull requests

- Keep each pull request to one change.
- `npm test` must pass.
- Match the existing style: no semicolons, two-space indent, short comments that say why.
- UI copy is short and plain. No filler.

## Security

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository instead.
