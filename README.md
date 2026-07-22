the concept is it is a game where you create an interpreter for a language you learn by example

it starts off with "unknown unknown"

you can click to name a symbol
- you have to do this to get access to it in js. and your code receives Token[] as input, where token is defined in typescript as a union of all your named symbols

over the course of the game we explain the stack language, and then we add some features to it that require parsing. or something. idk. we could even do indentation based parsing. kind of interesting? ie: scopes & setting variables in a whitespace-sensitive language. hmmm.

CHANGES TO MAKE:

- I don't really like '#' for numbers. let's instead do: if the previous symbol was a number, extend the number. else, start a new one. and then we need a ',' to end a number.
- backwards is stupid? do we need backwards really?