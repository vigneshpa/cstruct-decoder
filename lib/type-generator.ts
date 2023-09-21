import { CType, CTypeGraph, CTypeTag } from "./struct-parser.ts";

export default function generateTypes(typeGraph: CTypeGraph) {
    let ret = "";

    function generateType(type: CType): string {
        switch (type.tag) {
            case CTypeTag.Array:
                if (type.elementType.tag === CTypeTag.Char)
                    return "string";
                return generateType(type.elementType) + "[]";
            case CTypeTag.Struct:
                return type.name;
            case CTypeTag.Int:
                if (type.length > 4)
                    return "bigint";
                return "number";
            case CTypeTag.Char:
                return "string";
        }
    }
    for (const struct of typeGraph.structs) {
        ret += `export interface ${struct.name} {\n`;
        for (const field of struct.fields) {
            ret += "    " + field.name + ": " + generateType(field.elementType) + ";\n";
        }
        ret += `}\n`;
    }
    ret += "export default interface _GeneratedTypeMap {\n"
    for (const struct of typeGraph.structs) {
        ret += "    " + struct.name + ":" + struct.name + ";\n";
    }
    ret += "}\n";
    return ret;
}