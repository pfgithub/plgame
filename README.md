# Plgame ([Play](https://pfg.pw/plgame))

plgame is a game where you program an interpreter for a programming language in javascript. But you don't know the programming language, you have to learn it one level at a time.

https://pfg.pw/plgame

## Rules/Issues

plgame does not currently enforce these rules, which trivialize the game and make it boring:

- Don't store the inputs to render() and use them to cheat at levels
  - This may be fixed later by running render() seperately
- Don't make a big map of correct inputs to outputs
  - This may be fixed later by keeping hidden test levels, or just by using enough examples that it gets annoying.

## Development

```
bun install

# generate levels, fmt, lint, test
bun check

# run dev server
bun generate-levels
bun src/devserver

# build static site
bun build
```

Levels & README are made by me. Everything else is prompted.
