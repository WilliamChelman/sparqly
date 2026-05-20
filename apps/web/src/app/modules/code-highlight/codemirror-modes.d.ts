// CodeMirror ships its language modes as side-effect JS files that register
// themselves on the CodeMirror singleton. @types/codemirror types the core
// and the runmode addon, but not the individual modes — declare the two this
// module imports so the side-effect imports type-check.
declare module 'codemirror/mode/turtle/turtle';
declare module 'codemirror/mode/javascript/javascript';
