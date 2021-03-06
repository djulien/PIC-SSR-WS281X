#!/usr/bin/env node
//DSL parser for Javascript

"use strict";
require("magic-globals"); //__file, __line, __func, etc
require("colors").enabled = true; //for console output; https://github.com/Marak/colors.js/issues/127
//const thru2 = require("through2"); //https://www.npmjs.com/package/through2
//console.error("dsl running ...".green_lt);


/////////////////////////////////////////////////////////////////////////////////
////
/// Wrap Javascript REPL as a stream:
//

const {/*Readable, Writable,*/ PassThrough} = require("stream");
const REPL = require("repl"); //https://nodejs.org/api/repl.html

const ReplStream =
module.exports.ReplStream =
function ReplStream(opts) //{tbd}
{
    const replin = new PassThrough(), replout = new PassThrough(); //REPL end-points
    const repl = REPL.start(
    {
        prompt: "", //don't want prompt
        input: replin, //send input stream to REPL
        output: replout, //send REPL output to next stage in pipeline
//            eval: "tbd",
//            writer: "tbd",
        replMode: REPL.REPL_MODE_STRICT, //easier debug
        ignoreUndefined: true, //only generate real output
//            useColors: true,
    });
    return new DuplexStream(replout, replin); //return endpts so caller can do more pipelining; CAUTION: in/out direction here
}


/////////////////////////////////////////////////////////////////////////////////
////
/// DSL preprocessor (similar to C preprocessor except macro names can be regex):
//

const {LineStream} = require('byline');
const thru2 = require("through2"); //https://www.npmjs.com/package/through2
const fs = require("fs");
//const CaptureConsole = require('capture-console');

const preproc =
module.exports.preproc =
function preproc(opts) //{??}
{
    if (!opts) opts = {};
//    return thru2(xform, flush); //syntax extensions
    const instrm = new PassThrough(); //wrapper end-point
    const outstrm = instrm
        .pipe(new LineStream({keepEmptyLines: true})) //preserve line#s for easier debug, need discrete lines for correct #directive handling
        .pipe(thru2(xform, flush)); //syntax fixups + extensions
//        repl.defineCommand(kywd, func);
    outstrm.macro = macro; //macro.bind(outstrm);
    outstrm.sendline = sendline; //sendline.bind(outstrm);
    outstrm.push_echo = opts.echo? function(str) { console.error(`echo: ${str.replace(/\n/mg, "\\n").cyan_lt}`); this.push(str); }: outstrm.push;
    outstrm.prefix = prefix;
    outstrm.suffix = suffix;

//use REPL to evalute #if and conditionals:
    const replout = new PassThrough(); //new end-point
    const repl = REPL.start(
    {
        prompt: "", //don't want prompt
        input: outstrm, //send preprocessed output to REPL
        output: replout, //send repl output to caller
//            eval: "tbd",
//            writer: "tbd",
        replMode: REPL.REPL_MODE_STRICT, //easier debug
        ignoreUndefined: true, //only generate real output
//            useColors: true,
    });
//    outstrm = replout;
    //        outstrm.on("exit", () => { });
    //        console.log(JSON.stringify(toAST(func), null, "  "));
    //    recursively walk ast;
    //    for each function call, add func to list
    //           if (func.toString().match(/main/))
    //             console.log(CodeGen(wait_1sec));
    return new DuplexStream(replout, instrm); //return endpts so caller can do more pipelining; CAUTION: in/out direction here

    function xform(chunk, enc, cb)
    {
        if (isNaN(++this.numlines)) this.numlines = 1;
        if (typeof chunk != "string") chunk = chunk.toString(); //TODO: enc?
        if ((this.numlines == 1) && chunk.match(/^\s*#\s*!/)) { this.push(`//${chunk}\n`); cb(); return; } //comment out shebang
//        chunk = chunk.replace(/[{,]\s*([a-z\d]+)\s*:/g, (match, val) => { return match[0] + '"' + val + '":'; }); //JSON fixup: numeric keys need to be quoted :(
        if (chunk.length)
        {
            if (!this.buf) this.linenum = this.numlines; //remember start line# of continued lines
            this.buf = (this.buf || "") + chunk; //.slice(0, -1);
//console.error(`line ${this.numlines}: last char ${this.buf.slice(-1)}`);
            if (chunk.slice(-1) == "\\") //line continuation (mainly for macros)
            {
                if (chunk.indexOf("//") != -1) warn(`single-line comment on ${this.numlines} interferes with line continuation`);
                this.buf = this.buf.slice(0, -1);
                cb();
                return;
            }
        }
//        this.push(chunk + ` //line ${this.linenum}\n`); //add line delimiter (and line# for debug)
        if (this.buf) //process or flush
        {
            var parts = this.buf.match(/^\s*#\s*([a-z0-9$@_]+)\s*(.*)\s*$/i); //look for macro #directive
            this.buf = parts? this.macro(parts[1], parts[2], this.linenum): this.macro(this.buf); //handle directives vs. expand macros
            this.sendline();
        }
        cb();
    }
    function flush(cb)
    {
        this.sendline("\\"); //reinstate line continuation char on last partial line; NOTE: should cause syntax error
        const now = new Date(); //Date.now();
//TODO: why is this.numlines off by 1?
        this.push(`//lines: ${this.linenum || 0}, ${warn.count? `warnings: ${warn.count}, `: ""}errors: ${error.count || 0}, src: ${opts.filename || "stdin"}, when: ${date2str(now)}\n`);
        this.suffix();
        if (opts.debug) dump_macros();
        cb();
    }
    function sendline(append)
    {
        if (!this.buf) return;
//        if (append) this.buf += append;
//        if (this.linenum != this.previous + 1) this.buf += ` //line ${this.linenum}`;
        this.prefix();
        const line_tracking = (this.linenum != this.previous + 1)? ` //line ${this.linenum}`: null; //useful for debug
        this.push_echo(`${this.buf}${append || ""}${line_tracking || ""}\n`); //NOTE: LineStream strips newlines; re-add them here
        this.previous = this.linenum; //avoid redundant line#s
        this.buf = null;
    }
    function prefix()
    {
        this.prefix = function() {}; //only need prefix once; CAUTION: do this first to avoid recursion
        this.push("const {dsl_include} = require('./dsl.js');\n");
        this.push("const CaptureConsole = require('capture-console');\n");
//        this.push("const toAST = require('to-ast');\n"); //https://github.com/devongovett/to-ast
//        this.push("CaptureConsole.startCapture(process.stdout, (outbuf) => { console.error(`stdout: '${outbuf.replace(/\n/gm, '\\n')}'`); process.stdin.push(outbuf); });\n");
        this.push("CaptureConsole.startCapture(process.stdout, (outbuf) => { outstrm.write(outbuf); });\n");
    }
    function suffix()
    {
        this.prefix(); //make sure this is done first
//        this.push(".save dj.txt\n");
//        this.push("const suffix = true;\n");
        this.push("CaptureConsole.stopCapture(process.stdout);\n");
//        this.push("JSON.stringify(toAST(main), null, '  ');\n");
    }
}


//store or expand macros:
function macro(cmd, linebuf, linenum)
{
    var parts;
    if (arguments.length == 1) [cmd, linebuf] = [null, cmd];
//console.log(`macro: cmd '${cmd}', line '${(linebuf || "").replace(/\n/gm, "\\n")}'`);
    switch (cmd)
    {
//        case "define"
        case null: //expand macros
/*
            for (;;) //keep expanding while there is more to do
            {
                var expanded = 0;
                for (var m in macro.defs || {})
                {
                    break;
                    if (macro.defs[m].arglist !== null) //with arg list
                        linebuf.replace()
                }
                break;
            }
*/
            return linebuf;
        case "warning": //convert to console output (so that values will be expanded)
//NOTE: allow functions, etc; don't mess with quotes            if (!linebuf.match(/^[`'"].*[`'"]$/)) linebuf = "\"" + linebuf + "\"";
            return `console.error(${str_trim(linebuf)});`; //add outer () if not there (remove + readd)
        case "error": //convert to console output (so that values will be expanded)
//            if (!linebuf.match(/^`.*`$/)) linebuf = "`" + linebuf + "`";
//            return `console.error(${linebuf}); process.exit(1);`;
            return `throw ${linebuf}`; //leave quotes, parens as is
        case "include": //generate stmt to read file, but don't actually do it (REPL will decide)
//            parts = linebuf.match(/^\s*("([^"]+)"|([^ ])\s?)/);
//            if (!parts) return warn(`invalid include file '${linebuf}' on line ${linenum}`);
//            const [instrm, outstrm] = [infile? fs.createReadStream(infile.slice(1, -1)): process.stdin, process.stdout];
//console.error(`read file '${parts[2] || parts[3]}' ...`);
//            var contents = fs.readFileSync(parts[2] || parts[3]); //assumes file is small; contents needed in order to expand nested macros so just use sync read
//            return contents;
            return `dsl_include(${str_trim(linebuf)});`; //add outer () if not there (remove + readd)
        case "define": //save for later expansion
            if (!macro.defs) macro.defs = {};
            parts = linebuf.match(/^([a-z0-9_]+)\s*(\(\s*([^)]*)\s*\)\s*)?(.*)$/i);
            if (!parts) warn(`invalid macro definition ignored on line ${linenum}`);
            else if (macro.defs[parts[1]]) warn(`duplicate macro '${parts[1]}' definition (line ${linenum}, prior was ${macro.defs[parts[1]].linenum})`);
            else macro.defs[parts[1]] = {arglist: parts[3], body: parts[4], linenum};
            return; //no output
        default:
            warn(`ignoring unrecognized pre-processor directive '${cmd}' (line ${linenum})`);
            return linebuf;
    }
    function str_trim(str) //trim quotes and trailing semi-colon; NOTE: assumes only 1 param
    {
        return str.replace(/;\s*$/, "").replace(/^\s*\(\s*(.*)\s*\)\s*$/, "$1");
    }
}


function dump_macros()
{
//    Object.keys(macro.defs || {}).forEach(m =>
    for (var m in macro.defs || {})
    {
        var has_args = macro.defs[m][0];
        console.error(`macro '${m.cyan_lt + "".blue_lt}': ${has_args? "(" + macro.defs[m].arglist + ")": ""} '${macro.defs[m].body} line ${macro.defs[m].linenum}'`.pink_lt);
    }
}


const dsl_include =
module.exports.dsl_include =
function dsl_include(filename)
{
    console.log(`//contents of '${filename}':\n`);
    console.log(fs.readFileSync(filename).toString()); //assumes file is small; contents needed in order to expand nested macros so just use sync read
}


/////////////////////////////////////////////////////////////////////////////////
////
/// Transform DSL source code to Javascript (stream):
//

const DuplexStream = require("duplex-stream"); //https://github.com/samcday/node-duplex-stream
//const thru2 = require("through2"); //https://www.npmjs.com/package/through2
//const {/*Readable, Writable,*/ PassThrough} = require("stream");
//const {LineStream} = require('byline');
//const RequireFromString = require('require-from-string');
//const CaptureConsole = require("capture-console");
//const toAST = require("to-ast"); //https://github.com/devongovett/to-ast
//const REPL = require("repl"); //https://nodejs.org/api/repl.html


const dsl2js =
module.exports.dsl2js =
function dsl2js(opts) //{filename, replacements, prefix, suffix, debug, shebang}
{
    if (!opts) opts = {};
//TODO: define custom ops
//    const instrm = new Readable();
//    const outstrm = //new Writable();
//    instrm
//        .pipe(new LineStream({keepEmptyLines: true})) //preserve line#s (for easier debug)
//        .pipe(thru2(xform, flush)); //{ objectMode: true, allowHalfOpen: false },
//        .pipe(outstrm);
//    retval.infile = infile;
//    PreProc.latest = retval;
//    return new DuplexStream(outstrm, instrm); //return endpts; CAUTION: swap in + out
//    instrm.pipe = function(strm) { return outstrm.pipe(strm); };
//    return instrm;
    const instrm = new PassThrough(); //wrapper end-point
//    const instrm = new LineStream({keepEmptyLines: true}); //preserve line#s (for easier debug)
    if (opts.debug)
    {
        console.error(`${process.argv.length} dsl args:`.blue_lt);
        for (var a in process.argv)
            console.error(`arg[${a}/${process.argv.length}]: '${process.argv[a]}'`.blue_lt);
    }
    var outstrm = instrm
//        .pipe(new LineStream({keepEmptyLines: true})) //preserve line#s (for easier debug and correct #directive handling)
//        .pipe(preproc())
        .pipe(thru2(xform, flush)); //syntax fixups
/*NOTE: REPL doesn't really add any value - can load module from source code instead
    if ("run" in opts) //execute logic
    {
        const [replin, replout] = [outstrm, new PassThrough()]; //new end-point
        const repl = REPL.start(
        {
            prompt: "", //don't want prompt
            input: replin, //send output from DSL code to repl
            output: replout, //send repl output to caller
//            eval: "tbd",
//            writer: "tbd",
            replMode: REPL.REPL_MODE_STRICT, //easier debug
            ignoreUndefined: true, //only generate real output
//            useColors: true,
        });
//        repl.defineCommand(kywd, func);
        if (opts.debug) repl
            .on("exit", data => { if (!data) data = ""; console.error(`repl exit: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
        if (opts.debug) replin
            .on("data", data => { if (!data) data = ""; console.error(`repl in len ${data.toString().length}: ${data.toString().replace(/\n/gm, "\\n")}`.blue_lt); })
            .on("end", data => { if (!data) data = ""; console.error(`repl in end: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("finish", data => { if (!data) data = ""; console.error(`repl in finish: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("close", data => { if (!data) data = ""; console.error(`repl in close: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("error", data => { if (!data) data = ""; console.error(`repl in error: ${typeof data} ${data.toString().length}:${data.toString()}`.red_lt); });
//        const module = RequireFromString()[opts.run]();: new PassThrough());
        if (opts.debug) replout
            .on("data", data => { if (!data) data = ""; console.error(`repl out len ${data.toString().length}: ${data.toString().replace(/\n/gm, "\\n")}`.blue_lt); })
            .on("end", data => { if (!data) data = ""; console.error(`repl out end: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("finish", data => { if (!data) data = ""; console.error(`repl out finish: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("close", data => { if (!data) data = ""; console.error(`repl out close: ${typeof data} ${data.toString().length}:${data.toString()}`.cyan_lt); })
            .on("error", data => { if (!data) data = ""; console.error(`repl out error: ${typeof data} ${data.toString().length}:${data.toString()}`.red_lt); });
        outstrm = replout;
//        outstrm.on("exit", () => { });
//        console.log(JSON.stringify(toAST(func), null, "  "));
//    recursively walk ast;
//    for each function call, add func to list
//           if (func.toString().match(/main/))
//             console.log(CodeGen(wait_1sec));
    }
*/
    return new DuplexStream(outstrm, instrm); //return endpts for more pipelining; CAUTION: swap in + out

    function xform(chunk, enc, cb)
    {
        if (typeof chunk != "string") chunk = chunk.toString(); //TODO: enc?
        if (chunk.length)
        {
            if (!opts.shebang && (this.linenum == 1) && chunk.match(/^\s*#\s*!/)) { this.push("//" + chunk + "\n"); cb(); return; } //skip shebang; must occur before prepend()
            prepend.call(this);
//            this.push(chunk + ` //line ${this.linenum}\n`); //add line delimiter (and line# for debug)
//            this.push(chunk + `; "line ${this.linenum}";\n`); //add line delimiter (and line# for debug)
//            this.push(chunk + "\n"); //NO- add line delimiter (and line# for debug)
            this.push(chunk);
        }
        cb();
    }
    function flush(cb)
    {
        append.call(this);
        if (opts.run) this.push(`const ast = require("${process.argv[1]}").walkAST(${opts.run});\n`);
        cb();
    }

    function xxform(chunk, enc, cb)
    {
        if (isNaN(++this.numlines)) this.numlines = 1;
        if (typeof chunk != "string") chunk = chunk.toString(); //TODO: enc?
//        chunk = chunk.replace(/[{,]\s*([a-z\d]+)\s*:/g, (match, val) => { return match[0] + '"' + val + '":'; }); //JSON fixup: numeric keys need to be quoted :(
//        inject.call(this);
        if (chunk.length)
        {
//            if (!this.buf) this.linenum = this.numlines;
//            this.buf = (this.buf || "") + chunk; //.slice(0, -1);
//console.error(`line ${this.numlines}: last char ${this.buf.slice(-1)}`);
//            if (chunk.slice(-1) == "\\") //line continuation (mainly for macros)
//            {
//                if (chunk.indexOf("//") != -1) warn(`single-line comment on ${this.numlines} interferes with line continuation`);
  //              this.buf = this.buf.slice(0, -1);
//                this.push(chunk.slice(0, -1)); //drop backslash and don't send newline
//                cb();
//                return;
//            }
//            else
            this.linenum = this.numlines;
//            var keep = (opts.replacements || []).every((replace, inx, all) =>
//            {
//                if (chunk.match(/^\s*#\s*!/)) chunk = "//" + chunk; //skip shebang
//            }, this);
//            if (keep)
//            chunk = (opts.preprocess || noshebang)(chunk);
//            if (!opts.shebang && (this.linenum == 1)) chunk = chunk.replace(/^\s*#\s*!/, "//$&$'"); //skip shebang
//            if (parts = chunk.match(/^\s*#\s*([^ ]+))) //preprocessor directive
//            {
//
//            }
//            if (opts.preprocess) chunk = opts.preprocess(chunk);
            if (!opts.shebang && (this.linenum == 1) && chunk.match(/^\s*#\s*!/)) { this.push("//" + chunk + "\n"); cb(); return; } //skip shebang; must occur before prepend()
            prepend.call(this);
//            this.push(chunk + ` //line ${this.linenum}\n`); //add line delimiter (and line# for debug)
            this.push(chunk + `; "line ${this.linenum}";\n`); //add line delimiter (and line# for debug)
}
//        if (this.buf) //process or flush
////        {
//            var parts = this.buf.match(/^\s*#\s*([a-z0-9_]+)\s*(.*)\s*$/i);
//            this.buf = parts? macro(parts[1], parts[2], this.linenum): macro(this.buf); //handle directives vs. expand macros
//            if (this.buf) this.push(/-*this.linenum + ": " +*-/ this.buf + "\n");
//            this.buf = null;
//        }
//        this.push(chunk);
        cb();
    }
    function xflush(cb)
    {
//        inject.call(this);
//        const now = new Date(); //Date.now();
//        if (this.buf) this.push(this.buf + "\\\n"); //reinstate line continuation char on last partial line
//TODO: why is this.numlines off by 1?
//        this.push(`//eof; lines: ${this.linenum || 0}, warnings: ${warn.count || 0}, errors: ${error.count || 0}, src: ${this.infile}, when: ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${nn(now.getMinutes())}:${nn(now.getSeconds())}\n`);
//        dump_macros();
//        this.push("console.log(\"end\");");
        append.call(this);
        if (opts.run) this.push(`const ast = require("${process.argv[1]}").walkAST(${opts.run});\n`);
        cb();
    }
    function prepend()
    {
        if (this.prepended) return; //this.prepended) return; //only do once
//var dcls at global scope requires either entire source to be executed, or traverse ast and extract var dcls
//        this.push("function dsl_wrapper()\n{\n\"use strict\";\n");
        this.push("module.exports = function()\n{\n\"use strict\";\n");
//        this.push("require(\"dsl.js\").ast(\nfunction()\n{\n"})
        this.push(opts.prefix || "console.log(\"code start\");\n");
        this.prepended = true;
    }
//    function noshebang(str)
//    {
//        return str.replace(/^\s*#\s*!/, "//$&$'"); //skip shebang
//    }
    function append()
    {
        prepend.call(this); //in case not done yet
        this.push(opts.suffix || "console.log(\"code end\");\n");
//        this.push("}\nrequire(\"to-ast\")(dsl_wrapper);\n");
//        this.push("}\nrequire(\"./dsl.js\").walkAST(dsl_wrapper, ast_cb);\n");
        this.push("}\n");
    }
}


/////////////////////////////////////////////////////////////////////////////////
////
/// Transform Javascript source code into JSON AST (stream):
//

/*
//const {collect} = require("collect-stream"); //https://github.com/juliangruber/collect-stream
const RequireFromString = require('require-from-string'); //https://github.com/floatdrop/require-from-string
const toAST = require("to-ast"); //https://github.com/devongovett/to-ast

const js2ast =
module.exports.js2ast =
function js2ast(opts)
{
//    const retval = thru2(xform, flush); //{ objectMode: true, allowHalfOpen: false },
//    const retval = new PassThrough(); //collector end-point for use with pipeline
//    collect(retval, (err, data) => { console.error(`req2str: write ${data.length} to passthru`); retval.write(data); });
//based on example from https://stackoverflow.com/questions/10623798/writing-node-js-stream-into-a-string-variable
//    const chunks = [];
//    retval.on("data", (chunk) => { chunks.push(chunk); });
//    retval.on("end", () =>
//    {
//        const ast = toAST(entpt); //NOTE: only generates AST for one function, so make it a wrapper to everything of interest
//        const ast = toAST(RequireFromString(Buffer.concat(chunks).toString()));
//    });
    return thru2(xform, flush); //{ objectMode: true, allowHalfOpen: false },

    function xform(chunk, enc, cb) //collect stream in memory
    {
        if (!this.chunks) this.chunks = [];
        this.chunks.push(chunk);
        cb();
    }
    function flush(cb) //compile buffered using require(), emit AST as JSON
    {
        const code = Buffer.concat(this.chunks || []).toString(); //CAUTION: could use a lot of memory
        const compile = RequireFromString(code);
        const ast = toAST(compile);
        const json = JSON.stringify(ast, null, "  ");
        this.push(json);
        cb();
    }
}
*/


/////////////////////////////////////////////////////////////////////////////////
////
/// Traverse ast:
//

//const toAST = require("to-ast"); //https://github.com/devongovett/to-ast
const walkAST =
module.exports.walkAST =
//traverse AST, use main() as root:
//returns array of top-level functions
function walkAST(entpt, ast_cb)
{
    const ast = toAST(entpt); //NOTE: only generates AST for one function, so make it a wrapper to everything of interest
    (ast_cb || ast2json)(ast);
    
    function ast2json(ast)
    {
        console.log(JSON.stringify(ast, null, "  "));
    }
}
function junk()
{
/*
    const funclist = [entpt], seen = {}; //start out with main entry point, add dependent functions during traversal (skips unused functions)
//recursively walk ast
//    for each function call, add func to list
//    if (func.toString().match(/main/))
//        console.log(CodeGen(wait_1sec));
    for (var i = 0; i < funclist.length; ++i) //CAUTION: loop size might grow during traversal
    {
//        funclist[i] = traverse(funclist[i]);
        const ast = toAST(funclist[i]); //symbol -> AST
//        expected(funclist[i], ast.type, "FunctionExpression");
//        expected(`${funclist[i]}.id`, ast.id.type, "Identifier");
//        console.log(`/-*const ast_${ast.id.name} =*-/ ${JSON.stringify(ast, null, "  ")};\n`);
//        if (ast.body.type == "BlockStatement")
//            ast.body.body.forEach(stmt =>
        seen[funclist[i]] = ast;
        console.log(`ast_${funclist[i]} = ${JSON.stringify(ast, null, "  ")}`);
        traverse(funclist[i], ast, "FunctionExpression");
    }
    return funclist.map((item, inx) => { return seen[item]}); //return ASTs to caller, not just symbols
*/

    function traverse(name, ast_node, want_type)
    {
        if (want_type && (ast_node.type != want_type)) throw `AST: expected '${name}' to be ${want_type}, not ${ast_node.type}`.red_lt;
        switch (ast_node.type)
        {
            case "FunctionExpression": //{id, params[], defaults[], body{}, generator, expression}
                if (!want_type) funclist.push(ast_node.id.name);; //add to active function list
                (ast_node.defaults || []).forEach((item, inx, all) => { traverse(`def[${inx}]`, item); });
                traverse(ast_node.id.name, ast_node.body);
                break;
            case "BlockStatement": //{type, body[]}
//                if (!ast_node.body) throw `AST: expected body for ${name}`.red_lt;
                (ast_node.body || []).forEach((item, inx, all) => { traverse(`block[${inx}]`, item); });
                break;
            case "VariableDeclaration": //{type, declarations[], kind}
                (ast_node.declarations || []).forEach((item, inx, all) => { traverse(`decl[${inx}]`, item); });
                break;
            case "VariableDeclarator": //{type, id, init{}}
                traverse(ast_node.id.name, ast_node.init);
                break;
            case "ArrayExpression": //{type, elements[]}
                (ast_node.elements || []).forEach((item, inx, all) => { traverse(`item[${inx}]`, item); });
                break;
            case "ExpressionStatement": //{type, expression{}}
                traverse(name, ast_node.expression);
                break;
            case "CallExpression": //{type, callee{}, arguments[]}
                var callee = (ast_node.callee.type == "MemberExpression")? `${ast_node.callee.object.name}.${ast_node.callee.property.name}`: ast_node.callee.name;
                console.log(`found call to ${callee}: ${JSON.stringify(ast_node.callee)}, already seen? ${!!seen[callee]}`);
                if (!seen[callee]) { funclist.push(callee); seen[callee] = toAST(callee); }
                (ast_node.arguments || []).forEach((item, inx, all) => { traverse(`arg[${inx}]`, item); });
                break;
            case "ArrowFunctionExpression": //{type, id, params[], defaults[], body{}, generator, expression}
                (ast_node.params || []).forEach((item, inx, all) => { traverse(`param[${inx}]`, item); });
                (ast_node.defaults || []).forEach((item, inx, all) => { traverse(`def[${inx}]`, item); });
                traverse(name, ast_node.body);
                break;
            case "BinaryExpression": //{type, operator, left{}, right{}}
                traverse("lhs", ast_node.left);
                traverse("rhs", ast_node.right);
                break;
//ignore leafs:
            case "Identifier": //{type, name}
            case "Literal" : //{type, value, raw}
            case "MemberExpression": //{type, computed, object{}, property{}}
                break;
            default: //for debug
                throw `AST: unhandled node type for ${name}: '${ast_node.type}'`.red_lt;
        }
//        return ast;
    }
//    function expected(name, what, want, is)
//    {
//        if (what != want) throw `AST: expected '${name}' to be a ${want}, not ${is}`.red_lt;
//    }
}


/////////////////////////////////////////////////////////////////////////////////
////
/// Helper functions:
//

const error =
module.exports.error =
function error(msg)
{
    if (isNaN(++error.count)) error.count = 1;
    console.error(("[ERROR] " + msg).red_lt);
}


const warn =
module.exports.warn =
function warn(msg)
{   
    if (isNaN(++warn.count)) warn.count = 1;
    console.error(("[WARNING] " + msg).yellow_lt);
}


//NOTE: hard-coded date/time fmt
const date2str =
module.exports.date2str =
function date2str(when)
{
    if (!when) when = new Date(); //when ||= new Date(); //Date.now();
    return `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()} ${when.getHours()}:${nn(when.getMinutes())}:${nn(when.getSeconds())}`;
}


//remove comment:
//handles // or /**/
//TODO: handle quoted strings
function nocomment(str)
{
    return str.replace(/(\/\/.*|\/\*.*\*\/)$/, "");
}


//const nn =
//module.exports.nn =
function nn(val) { return (val < 10)? "0" + val: val; }


function shebang_args(str, which)
{
    if (!which) str = str.replace(/\s*#.*$/, ""); //strip comments
    return (which < 0)? [str]: str.split(" "); //split into separate args
}

//function is_shebang(chunk)
//{
//    return (this.linenum == 1) && chunk.match(/^\s*#\s*!/);
//}

/*
var original = require.extensions['.js']
require.extensions['.js'] = function(module, filename) {
  if (filename !== file) return original(module, filename)
  var content = fs.readFileSync(filename).toString()
  module._compile(stripBOM(content + replCode), filename)
}
*/


/////////////////////////////////////////////////////////////////////////////////
////
/// Unit test/command-line interface:
//

if (!module.parent) //auto-run CLI
{
//    const RequireFromString = require('require-from-string');
//    const Collect = require("collect-strean");
//    const {LineStream} = require('byline');
    const pathlib = require("path");
    const fs = require("fs");
    const CWD = "";
//    const filename = (process.argv.length > 2)? `'${pathlib.relative(CWD, process.argv.slice(-1)[0])}'`: null;
    const opts = {}, debug_out = [];
    for (var i = 0; i < process.argv.length; ++i) //command line options; NOTE: shebang in input file might also have args (split and strip comments)
        shebang_args(process.argv[i], i - 2).forEach((arg, inx, all) =>
        {
            const argname = `arg[${i}/${process.argv.length}${(all.length != 1)? `,${inx}/${all.length}`: ""}]`;
            debug_out.push(`${argname}: '${arg}'`); //remember debug output in case wanted (options can be in any order)
            if (i < 2) return; //skip prog names
            var parts = arg.match(/^([+-])?([^=]+)(=(.*))?$/);
            if (!parts || (parts[1] && parts[3])) { console.error(`invalid option in ${argname}: '${arg}'`.red_lt); return; }
            if (!parts[1] && !parts[4]) opts.filename = parts[2];
            else opts[parts[2].toLowerCase()] = /*(parts[1] == "-")? false: (parts[1] == "+")*/ parts[1]? true: parts[4];
        });
//    console.log(JSON.stringify(opts, null, "  "));
    if (opts.debug /*!= undefined*/) console.error(debug_out.join("\n").blue_lt);
    if (opts.help /*!= undefined*/) console.error(`usage: ${pathlib.basename(__filename)} [+-codegen] [+-debug] [+-echo] [+-help] [+-src] [filename]\n\tcodegen = don't generate code from ast\n\tdebug = show extra info\n\techo = show macro-expanded source code into REPL\n\tfilename = file to process (defaults to stdin if absent)\n\thelp = show usage info\n\tsrc = display source code instead of compiling it\n`.yellow_lt);
    console.error(`DSL: reading from ${opts.filename || "stdin"} ...`.green_lt);
    const [instrm, outstrm] = [opts.filename? fs.createReadStream(opts.filename): process.stdin, process.stdout]; //fs.createWriteStream("dj.txt")];
    instrm
//        .pipe(prepend())
//        .pipe(new LineStream({keepEmptyLines: true})) //preserve line#s (for easier debug)
//        .pipe(PreProc(infile))
//        .pipe(fixups())
//        .pipe(preproc(opts))
        .pipe(ReplStream(opts))
//        .pipe(!opts.src? dsl2js(opts): new PassThrough()) //{filename, debug: true})) //, run: "main"}))
//        .pipe((!opts.src && !opts.codegen)? js2ast(opts): new PassThrough())
//        .pipe(asm_optimize())
//    .pipe(text_cleanup())
//        .pipe(append())
//        .pipe(RequireStream())
//        .pipe(json2ast())
//        .pipe((opts.codegen /*!= undefined*/)? new PassThrough(): js2ast(opts))
        .pipe(outstrm)
//        .on("data", (data) => { console.error(`data: ${data}`.blue_lt)})
        .on("finish", () => { console.error("finish".green_lt); })
        .on("close", () => { console.error("close".green_lt); })
        .on("done", () => { console.error("done".green_lt); })
        .on("end", () => { console.error("end".green_lt); })
        .on("error", err =>
        {
            console.error(`error: ${err}`.red_lt);
            process.exit();
        });
    console.error("DSL: finish asynchronously".green_lt);
}
//                  ____________________________
//                 /                            \
//file or stdin ---\--> macro expand -> REPL ---/----> AST

//eof