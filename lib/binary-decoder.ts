import { CArrayType, CCharType, CIntType, CStructDefinitionField, CStructType, CType, CTypeGraph, CTypeTag } from "./struct-parser.ts";

export function decodeData(typeGraph: CTypeGraph, rootType: CType, rawData: ArrayBuffer, isLE = true) {

    function getStructDefinition(name: string) {
        const struct = typeGraph.structs.find(val => val.name === name);
        if (!struct)
            throw new Error("Unknown struct: " + JSON.stringify(name));
        return struct;
    }

    // function getSize(type: CType): number {
    //     const ret = getSizeOrg(type);

    //     switch (type.tag) {
    //         case CTypeTag.Struct:
    //             console.log("STRUCT ", type.name, ret);
    //             break;
    //         case CTypeTag.Array:
    //             console.log("ARRAY ", type.elementType.tag, ret);
    //             break;
    //         case CTypeTag.Int:
    //             console.log("INT ", ret);
    //             break;
    //         case CTypeTag.Char:
    //             console.log("CHAR ", ret);
    //             break;
    //     }
    //     return ret;
    // }

    function getSize(type: CType): number {
        switch (type.tag) {
            case CTypeTag.Int:
                return type.length;
            case CTypeTag.Char:
                return type.length;
            case CTypeTag.Struct: {
                let acc = 0;
                const fields = getStructDefinition(type.name).fields;
                for (const field of fields)
                    acc += getSize(field.elementType);
                // console.log(acc, JSON.stringify(fields));
                return acc;
            }
            case CTypeTag.Array:
                return getSize(type.elementType) * type.length;
        }
    }

    function decodeInt(data: ArrayBuffer, type: CIntType): number | string {
        const view = new DataView(data);
        if (type.signed) {
            switch (type.length) {
                case 1:
                    return view.getInt8(0);
                case 2:
                    return view.getInt16(0, isLE);
                case 4:
                    return view.getInt32(0, isLE);
                case 8:
                    return view.getBigInt64(0, isLE).toString();
            }
        } else {
            switch (type.length) {
                case 1:
                    return view.getUint8(0);
                case 2:
                    return view.getUint16(0, isLE);
                case 4:
                    return view.getUint32(0, isLE);
                case 8:
                    return view.getBigUint64(0, isLE).toString();
            }
        }

        throw new Error("Integer length is not decodable!");
    }

    function decodeCharArray(data: ArrayBuffer, type: CArrayType): string {
        if (type.elementType.tag !== CTypeTag.Char)
            throw new Error("Expected char array");
        const decoder = new TextDecoder(type.elementType.length === 2 ? ("utf-16" + (isLE ? "le" : "be")) : "utf-8");
        return decoder.decode(data);
    }

    function decodeChar(data: ArrayBuffer, type: CCharType): string {
        const decoder = new TextDecoder(type.length === 2 ? ("utf-16" + (isLE ? "le" : "be")) : "utf-8");
        return decoder.decode(data);
    }

    function decodeArray(data: ArrayBuffer, type: CArrayType): any[] | string {
        if (type.elementType.tag === CTypeTag.Char)
            return decodeCharArray(data, type);
        const ret = [];
        const elementSize = getSize(type.elementType);
        for (let i = 0; i < type.length; i++)
            ret.push(decodeBuf(data.slice(i * elementSize, (i + 1) * elementSize), type.elementType));
        return ret;
    }

    function decodeStruct(data: ArrayBuffer, type: CStructType) {
        const ret: Record<string, any> = {};
        const fields = getStructDefinition(type.name).fields;
        let offset = 0;
        for (const field of fields) {
            const oldOffset = offset;
            offset += getSize(field.elementType);
            const slice = data.slice(oldOffset, offset);
            // console.log(slice, field.elementType.tag);
            ret[field.name] = decodeBuf(slice, field.elementType);
        }
        return ret;
    }

    // Dispatch to proper function
    function decodeBuf(data: ArrayBuffer, type: CType) {
        if (getSize(type) !== data.byteLength)
            throw new Error("Type size does not match with the given buffer size: " + getSize(type) + " and " + data.byteLength);

        switch (type.tag) {
            case CTypeTag.Array:
                return decodeArray(data, type);
            case CTypeTag.Struct:
                return decodeStruct(data, type);
            case CTypeTag.Int:
                return decodeInt(data, type);
            case CTypeTag.Char:
                return decodeChar(data, type);
        }
    }

    return decodeBuf(rawData, rootType);
}