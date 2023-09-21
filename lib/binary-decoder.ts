// deno-lint-ignore-file no-explicit-any
import { CArrayType, CCharType, CIntType, CStructType, CType, CTypeGraph, CTypeTag } from "./struct-parser.ts";

export function getTypeSize(graph: CTypeGraph, type: CType): number {
    switch (type.tag) {
        case CTypeTag.Int:
            return type.length;
        case CTypeTag.Char:
            return type.length;
        case CTypeTag.Struct: {
            let acc = 0;
            const fields = getStructDefinition(graph, type.name).fields;
            for (const field of fields)
                acc += getTypeSize(graph, field.elementType);
            // console.log(acc, JSON.stringify(fields));
            return acc;
        }
        case CTypeTag.Array:
            return getTypeSize(graph, type.elementType) * type.length;
    }
}

function getStructDefinition(graph: CTypeGraph, name: string) {
    const struct = graph.structs.find(val => val.name === name);
    if (!struct)
        throw new Error("Unknown struct: " + JSON.stringify(name));
    return struct;
}

export function decodeData(graph: CTypeGraph, rootType: CType, rawData: ArrayBuffer, isLE = true) {


    function getSize(type: CType): number {
        return getTypeSize(graph, type);
    }

    function decodeInt(view: DataView, type: CIntType): number | bigint {
        if (type.signed) {
            switch (type.length) {
                case 1:
                    return view.getInt8(0);
                case 2:
                    return view.getInt16(0, isLE);
                case 4:
                    return view.getInt32(0, isLE);
                case 8:
                    return view.getBigInt64(0, isLE);
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
                    return view.getBigUint64(0, isLE);
            }
        }

        throw new Error("Integer length is not decodable!");
    }

    function decodeNullTerminatedString(data: DataView, isUnicode: boolean) {
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const arr = isUnicode ? new Uint16Array(buf) : new Uint8Array(buf);
        const decoder = new TextDecoder(isUnicode ? "utf-16" + (isLE ? "le" : "be") : "utf-8");
        let idx = arr.indexOf(0);
        if (idx === -1)
            idx = arr.length;
        const slice = arr.slice(0, idx);
        return decoder.decode(slice);
    }

    function decodeCharArray(data: DataView, type: CArrayType): string {
        if (type.elementType.tag !== CTypeTag.Char)
            throw new Error("Expected char array");
        return decodeNullTerminatedString(data, type.elementType.length === 2);
    }

    function decodeChar(data: DataView, type: CCharType): string {
        return decodeNullTerminatedString(data, type.length === 2);
    }

    function decodeArray(data: DataView, type: CArrayType): any[] | string {
        if (type.elementType.tag === CTypeTag.Char)
            return decodeCharArray(data, type);
        const ret = [];
        const elementSize = getSize(type.elementType);
        for (let i = 0; i < type.length; i++)
            ret.push(decodeBuf(new DataView(data.buffer, data.byteOffset + (i * elementSize), elementSize), type.elementType))
        // ret.push(decodeBuf(data.slice(i * elementSize, (i + 1) * elementSize), type.elementType));
        return ret;
    }

    function decodeStruct(data: DataView, type: CStructType) {
        const ret: Record<string, any> = {};
        const fields = getStructDefinition(graph, type.name).fields;
        let offset = 0;
        for (const field of fields) {
            const size = getSize(field.elementType);
            const fieldView = new DataView(data.buffer, data.byteOffset + offset, size);
            offset += size;
            // console.log(slice, field.elementType.tag);
            ret[field.name] = decodeBuf(fieldView, field.elementType);
        }
        return ret;
    }

    // type DecodedStruct = Record<string, DecodedValue>;
    // type DecodedValue = number | string | DecodedValue[] | DecodedStruct;
    // Typescript do not allow cyclic Records! (currently)


    // Dispatch to proper function
    function decodeBuf(data: DataView, type: CType) {
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

    return decodeBuf(new DataView(rawData), rootType);
}

export function getStructReader<GeneratedTypeMap extends Record<string, any>>(graph: CTypeGraph) {

    return async function readStruct<T extends Extract<keyof GeneratedTypeMap, string>>(reader: ReadableStreamBYOBReader, name: T): Promise<GeneratedTypeMap[T]> {
        const rootType: CStructType = {
            tag: CTypeTag.Struct,
            name
        };
        const size = getTypeSize(graph, rootType);
        const buf = new Uint8Array(size);
        // It is past perfect (read it as "red") :)
        const read = await reader.read(buf);
        if (read.value?.byteLength !== size)
            throw new Error("Cannot read struct" + JSON.stringify(name));
        const data = decodeData(graph, rootType, read.value.buffer) as any;
        return data;
    }
}