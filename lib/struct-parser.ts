export enum CTypeTag {
    Struct = "struct",
    Array = "array",
    Int = "int",
    Char = "char"
}

export interface CIntType {
    tag: CTypeTag.Int;
    length: number;
    signed: boolean;
}

export interface CCharType {
    tag: CTypeTag.Char;
    length: number;
}

export interface CStructType {
    tag: CTypeTag.Struct;
    name: string;
}

export interface CStructDefinition {
    name: string;
    fields: CStructDefinitionField[];
}

export interface CStructDefinitionField {
    name: string;
    elementType: CType;
}

export interface CArrayType {
    tag: CTypeTag.Array;
    elementType: CType;
    length: number;
}

export type CType = CIntType | CCharType | CStructType | CArrayType;

export interface CTypeGraph {
    globalRoot: CStructDefinitionField[];
    structs: CStructDefinition[];
}

export default function getCParser() {

    const definitions = new Map<string, string>();
    const directiveLines: string[] = [];

    function define(line: string) {
        line = line.slice(8);
        line = removeComments(line);
        line = line.trim();
        const whitespace = line.match(/\s+/);
        const key = line.slice(0, whitespace?.index);
        const val = line.slice((whitespace?.index ?? 0) + (whitespace?.length ?? 0));
        const constLine = `const ${key} = ${val};\n`;
        definitions.set(key, val);
        return constLine;
    }

    function preprocessLine(line: string) {
        if (!line.startsWith("#"))
            return line;

        if (line.startsWith("#define "))
            return define(line);

        if (line.startsWith("#include ")) {
            return `// import ${JSON.stringify(line.slice(10, -1) + ".ts\n")}`;
        }
        return "// unknown_directive:" + line + "\n";
    }

    function removeComments(line: string) {
        const idx = line.indexOf("//");
        if (idx !== -1)
            line = line.slice(0, idx);

        line = line.replace(/\/\*.*\*\//g, "")

        return line;
    }

    function applyDefinitions(line: string) {
        for (const [key, val] of definitions) {
            line = line.replaceAll(key, val);
        }
        return line;
    }

    function preprocess(data: string): string {
        const out: string[] = [];
        const lines = data.split(/\n/g);
        for (let line of lines) {
            if (line.startsWith("#")) {
                directiveLines.push(preprocessLine(line));
                continue;
            }
            line = removeComments(line);
            line = line.trim();
            if (line)
                out.push(line);
        }
        return out
            .map(applyDefinitions) // pass 1
            .map(applyDefinitions) // pass 2
            .join("\n");
    }


    const structStore = new Map<string, string>();

    function findClosingBrace(data: string, start: number) {
        let stack = 0;
        for (let i = start; i < data.length; i++) {
            const char = data.charAt(i);
            if (char === "{") {
                stack++;
            } else if (char === "}") {
                stack--;
                if (stack === -1) {
                    return i;
                }
            }
        }
        return data.length;
    }

    function parseIntType(fir: FieldIR): CIntType | null {
        const match = /^(u?)int([0-9]+)_t$/.exec(fir.ftype);
        if (!match)
            return null;

        const signed = !match[1];
        const length = parseInt(match[2]) / 8;
        return {
            tag: CTypeTag.Int,
            length, signed
        }
    }

    function parseCharType(fir: FieldIR): CCharType | null {
        const match = /^char([0-9]+)_t$/.exec(fir.ftype);
        if (!match)
            return null;

        const length = parseInt(match[1]) / 8;
        return {
            tag: CTypeTag.Char,
            length,
        }
    }

    function parseArray(fir: FieldIR): CArrayType | null {
        const match = /\[([0-9]+)\]$/.exec(fir.name);
        if (!match)
            return null;

        const length = parseInt(match[1]);

        fir.name = fir.name.slice(0, match.index);

        const elementType = parseFieldType(fir);
        return {
            tag: CTypeTag.Array,
            elementType,
            length,
        }
    }

    function parseFieldStruct(fir: FieldIR): CStructType | null {
        const match = /struct\$([A-Za-z0-9_]+)/.exec(fir.ftype);
        if (!match)
            return null;

        const name = match[1];

        const struct = structStore.has(name);
        if (!struct)
            throw new Error("Unknown struct: " + JSON.stringify(name));
        return {
            tag: CTypeTag.Struct,
            name,
        };
    }

    function parseFieldType(fir: FieldIR): CType {

        if (typedefMap.has(fir.ftype))
            fir.ftype = typedefMap.get(fir.ftype)!; // pass 1

        if (typedefMap.has(fir.ftype))
            fir.ftype = typedefMap.get(fir.ftype)!; // pass 2

        const array = parseArray(fir);
        if (array)
            return array;

        const struct = parseFieldStruct(fir);
        if (struct)
            return struct;

        const int = parseIntType(fir);
        if (int)
            return int;

        const char = parseCharType(fir);
        if (char)
            return char;

        throw new Error("Unknwon type found: " + JSON.stringify(fir.ftype));
    }

    interface FieldIR {
        name: string,
        ftype: string,
    }

    function parseFieldLine(line: string) {

        line = line.replace(/struct\s+/g, "struct$").trim();
        const match = /([^\s]+)$/.exec(line);
        if (!match)
            throw new Error("No field name");

        const fir: FieldIR = {
            ftype: line.slice(0, match.index).trim(),
            name: match[1],
        };

        if (!fir.ftype || !fir.name)
            return false;

        const elementType = parseFieldType(fir);
        const name = fir.name;

        return { name, elementType } as CStructDefinitionField;
    }

    const typedefMap = new Map<string, string>();
    function parseTypedef(line: string) {
        line = line.replace(/struct\s+/g, "struct$");
        const match = /typedef\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/.exec(line);
        if (!match)
            return false;

        const key = match[2];
        const val = match[1];

        typedefMap.set(key, val);

        return true;
    }

    function parseStatementLine(line: string) {
        line = line.trim();
        if (!line)
            return false;
        if (parseTypedef(line))
            return false;
        return parseFieldLine(line);
    }

    function parseStatements(data: string) {
        return data.split(/;/g)
            .map(st => st.trim())
            .filter(ln => !!ln)
            .map(parseStatementLine)
            .filter(vl => !!vl) as CStructDefinitionField[];
    }

    function parseStruct(name: string, body: string): CStructDefinition {
        const fields: CStructDefinitionField[] = parseStatements(body);

        return {
            name,
            fields,
        }
    }

    // removes struct body and store them in struct store
    function reduceStruct(data: string): string {
        const match = /struct\s+([A-Za-z0-9_]+)\s*{/.exec(data);
        if (!match)
            return data;

        const name = match[1];

        const bodyStart = match.index + match[0].length;
        const bodyEnd = findClosingBrace(data, bodyStart);

        const body = reduceStruct(data.slice(bodyStart, bodyEnd));

        if (structStore.has(name))
            throw new Error("Redefinition of struct: " + JSON.stringify(name));
        structStore.set(name, body)

        const rest = data.slice(bodyEnd + 1);

        return data.slice(0, match.index) + "struct " + name + (rest && reduceStruct(rest));
    }

    return function constructTypeGraph(data: string): CTypeGraph {
        data = preprocess(data);
        data = reduceStruct(data);
        const globalRoot = parseStatements(data);
        const structs = [...structStore.entries()].map(val => parseStruct(...val));
        return { globalRoot, structs };
    }
}