type Token = string & {__is_token: true};
function tokenize(input: string): Token[] {
    const output: Token[] = [];
    let uncommitted: string = "";
    const commit = () => {
        if (uncommitted !== "") {
            output.push(uncommitted as Token);
            uncommitted = "";
        }
    };
    for (const char of input) {
        if (char === " ") {
            commit();
        } else if (char.match(/[a-zA-Z_]/)) {
            uncommitted += char;
        } else {
            commit();
            output.push(char as Token);
        }
    }
    commit();
    return output;
}
type Level = {raw: string, input: Token[], output: Token[]};
function level(input: string, output: string): Level {
    return {raw: input, input: tokenize(input), output: tokenize(output)};
}

// symbols will get named a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z?
// or 0,1,2,3,4,5,6,7,8,9,10,11,12,...
// ^ don't want to do that because that gives an order to numbers that we're trying to keep secret for a little bit
// ^ or they start as "unnamed" and you click to name them <- I like this

// note we could choose to do hex numbers in this game
// actually let's do base 6? or base 8
// why?=less unnamed sigils to figure out
// ok base 6. or even base 4? no 6
export const levels: Level[] = [
    // copy input to output
    level("1#", "1#"),
    level("2#", "2#"),
    level("5#", "5#"),
    level("45#", "45#"),
    level("321#", "321#"),
    level("2451#", "2451#"),
    level("14#35#", "14#35#"), // this one is weird but you don't really notice that until later

    // trim trailing zeroes? confusing?
    level("50#", "5#"),
    level("02#", "02#"),
    level("400#", "4#"),
    level("02010#", "0201#"),
    level("05#", "05#"),
    level("030#", "03#"),
    level("0#", "0#"),
    level("00#", "0#"),

    // transform the value somehow?
    level("incr 4#", "5#"),
    level("incr 0#", "1#"),
    level("incr 1#", "2#"),
    level("incr 3#", "4#"),

    // transform the first digit somehow, and complete the 0→1,1→2,... mapping
    level("incr 03#", "13#"),
    level("incr 345#", "445#"),
    level("incr 25#", "35#"), // we skipped this one earlier
    level("incr 1435#", "2435#"),
    level("incr 3541#", "4541#"),

    // trailing zeroes still apply
    level("incr 450#", "55#"),
    level("incr 045#", "145#"),
    level("incr 0450#", "145#"),
    level("incr 2530010000#", "353001#"),

    // oh, it's increment
    level("incr 531#", "041#"),
    level("incr 5#", "01#"),
    level("incr 555#", "0001#"),
    level("incr 554#", "005#"),
    level("incr 51412#", "02412#"),
    level("incr 543210#", "05321#"),
    level("incr 52#", "03#"),
    level("incr 52#", "03#"),
    level("incr 50#", "01#"),
    level("incr #", "1#"), // plain # again

    // two # is back
    level("1# 1#", "1# 1#"),
    level("incr 1# 1#", "2# 1#"),
    level("1# incr 1#", "1# 2#"),
    level("incr 1# incr 1#", "2# 2#"),

    // multi increment
    level("incr incr 1#", "3#"),
    level("incr incr incr 1#", "4#"),
    level("incr incr incr incr 1#", "5#"),
    level("incr incr incr incr incr 1#", "01#"),
    level("incr incr incr incr incr incr 1#", "11#"),
    level("incr incr incr incr incr incr 5#", "51#"),

    // add 1
    level("add 1# 4#", "5#"),
    level("add 1# 2#", "3#"),
    level("add 1# 5#", "01#"),

    // add 1, reversed
    level("add 4# 1#", "5#"),
    level("add 2# 1#", "3#"),
    level("add 5# 1#", "01#"),

    // add 2
    level("add 5# 2#", "11#"),
    level("add 1# 2#", "3#"),
    level("add 4# 2#", "01#"),
    level("add 2# 2#", "4#"),
    level("add 3# 2#", "5#"),

    // add 6
    level("add 3# 01#", "31#"),
    level("add 31# 01#", "32#"),
    level("add 243# 01#", "253#"),

    // add n
    level("add 4# 3#", "11#"),

    // multiply
    level("mul 2# 1#", "2#"),
    level("mul 2# 2#", "4#"),
    level("mul 2# 3#", "01#"),
    level("mul 2# 4#", "21#"),
    level("mul 2# 5#", "41#"),
    level("mul 1# 2#", "2#"),
    level("mul 2# 2#", "4#"),
    level("mul 3# 2#", "01#"),
    level("mul 4# 2#", "21#"),
    level("mul 5# 2#", "41#"),
    level("mul 3# 5#", "32#"),
    level("mul 3# 01#", "03#"),

    // three items
    level("3# 2# 1#", "3# 2# 1#"),
    level("3# 3# 3#", "3# 3# 3#"),

    // order of operations
    level("add 3# 4# 5#", "11# 5#"),
    level("mul 3# 4# 5#", "02# 5#"),
    level("mul add 3# 4# 5#", "55#"),
    level("add mul 3# 4# 5#", "52#"),
    level("add add 3# 4# 5#", "02#"),
    level("mul mul 3# 4# 5#", "041#"),

    level("3# add 4# 5#", "3#31#"),
    level("3# mul 4# 5#", "3#23#"),
    level("add 3# add 4# 5#", "02#"),
    level("add 3# mul 4# 5#", "53#"),
    level("mul 3# add 4# 5#", "34#"),
    level("mul 3# mul 4# 5#", "041#"),

    // subtract

    // negative

    // the stack
    level("01# 02# 03#", "01# 02# 03#"),
    level("kill 01# 02# 03#", "02# 03#"),
    level("kill kill 01# 02# 03#", "03#"),
    level("kill kill kill 01# 02# 03#", ""),
    level("index 0# 01# 02# 03#", "01# 01# 02# 03#"),
    level("index 1# 01# 02# 03#", "02# 01# 02# 03#"),
    level("index 2# 01# 02# 03#", "03# 01# 02# 03#"),

    // lists (TODO we need some functions to make these useful
    level("[]", "[]"),
    level("[1#]", "[1#]"),
    level("1# [2#]", "1# [2#]"),
    level("[2# 1#]", "[2# 1#]"),
    // level("[incr 3#]", "[incr 3#]"), // do we want this? could be a way to make functions? idk
    // level("[add 2# 1#]", "[add 2# 1#]"),

    level("list_length []", "0#"),
    level("list_length [1#]", "1#"),
    level("list_length [2# 1#]", "2#"),
    level("list_length [4# 3#]", "2#"),
    level("5# []", "5# []"),
    level("list_push 5# []", "[5#]"),
    level("list_length list_push 5# []", "1#"),

    // list extras
    level("]", ""),
    level("[[]]", "[[]]"),
    level("]]", ""),
    level("[]]", "[]"),
    level("[1# 2# 3#]", "[1# 2# 3#]"),
    level("1# 2# 3#]", "1# 2# 3#"),
    level("1# 2# 3#]]", "1# 2# 3#"),
    level("[1# 2# 3#]]", "[1# 2# 3#]"),
    level("[[1# 2# 3#]]", "[[1# 2# 3#]]"),
    level("[4#[3#]2#[[1#]]]", "[4#[3#]2#[[1#]]]"),
    level("[", "ERR_no_exit"),

    // cases marking the specific function of numbers
    level("1# incr 1#", "1# 2#"),
    level("1 incr 1#", "12#"),
    level("5# incr 5#", "5# 01#"),
    level("5 incr 5#", "501#"),
    level("#", "0#"),
    level("4", "ERR_no_stack"),
    level("1:2", "ERR_no_stack"),

    /*
    ideas for the future:
    - some types. eg we can have a point with an x and a y field
    - scoped variables
    "set_var 0# 25#"
    - whitespace based definitions that need to be parsed. eg fn\n\tabc <- abc is part of fn
    "set_var 0# fn\n\tset_var 0# 25#"
    */
];

function execute(level: Token[]): Token[] {
    type StackValue = number | unknown;
    const stackstack: StackValue[][] = [];
    let stack: StackValue[] = [];
    const get = (): StackValue => {
        if (stack.length === 0) {
            throw new Error("ERR_no_stack");
        }
        return stack.pop()!;
    };
    const getnum = (): number => {
        const last = get();
        if (typeof last !== "number") {
            throw new Error("ERR_not_number");
        }
        return last;
    };
    const getlist = (): StackValue[] => {
        const last = get();
        if (!Array.isArray(last)) {
            throw new Error("ERR_not_list");
        }
        return last;
    };
    const put = (v: StackValue) => stack.push(v);
    const num = (n: number) => {
        put(getnum() * 6 + n);
    };
    const executors: Record<string, () => void> = {
        "0": () => num(0),
        "1": () => num(1),
        "2": () => num(2),
        "3": () => num(3),
        "4": () => num(4),
        "5": () => num(5),
        "#": () => put(0),
        "incr": () => put(getnum() + 1),
        "add": () => put(getnum() + getnum()),
        "mul": () => put(getnum() * getnum()),
        "]": () => {
            // enter list
            const list: StackValue[] = [];
            stackstack.push(stack);
            stack = list;
        },
        "[": () => {
            // exit list
            const parent = stackstack.pop();
            if (!parent) throw new Error("ERR_no_exit");
            const list = stack;
            stack = parent;
            stack.push(list);
        },
        "list_length": () => put(getlist().length),
        "list_push": () => {
            const arg = get();
            const list = [...getlist()];
            list.push(arg);
            put(list);
        },
        "kill": () => get(),
        "index": () => {
            const index = getnum();
            const idx = stack.length - index - 1;
            const val = stack[idx];
            if (val === undefined) throw new Error("ERR_index_out_of_range");
            put(val);
        },
    };
    try {
        for (const token of [...level].reverse()) {
            const xc = executors[token];
            if (!xc) throw new Error(`execution not implemented for token: ${token}`);
            executors[token]();
        }

        // now, convert stack to outcome
        const result: Token[] = [];
        const putresult = (stack: StackValue[]) => {
            for (const item of [...stack].reverse()) {
                if (typeof item === "number") {
                    for (const ent of [...item.toString(6)].reverse()) result.push(ent as Token);
                    result.push("#" as Token);
                } else if (Array.isArray(item)) {
                    result.push("[" as Token);
                    putresult(item);
                    result.push("]" as Token);
                } else throw new Error(`execution todo support resulting stack value: ${typeof item}`);
            }
        };
        putresult(stack);
        return result;
    } catch (e) {
        return [(e as Error).message as Token];
    }
}

// test each level
for (const [i, level] of levels.entries()) {
    const output = execute(level.input);
    if (JSON.stringify(output) !== JSON.stringify(level.output)) {
        console.error(`Error: Level ${i}: ${JSON.stringify(level.raw)}/${JSON.stringify(level.input)}\n  Expected ${JSON.stringify(level.output)}\n  Received ${JSON.stringify(output)}`);
    }
}

// execution:
// take the input and execute from right to left
// in the future we will add syntax stuff
// #=push(0)
// 0-6=> last = last * 6 + n
