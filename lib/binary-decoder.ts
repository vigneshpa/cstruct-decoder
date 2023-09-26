// deno-lint-ignore-file no-explicit-any
import type { BufReader } from "https://deno.land/std@0.201.0/io/buf_reader.ts";
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

export function getStructDefinition(graph: CTypeGraph, name: string) {
    const struct = graph.structs.find(val => val.name === name);
    if (!struct)
        throw new Error("Unknown struct: " + JSON.stringify(name));
    return struct;
}

export function decodeData(graph: CTypeGraph, rootType: CType, rawData: Uint8Array, isLE = true) {


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

    function isUint8(type:CType){
        return type.tag === CTypeTag.Int && type.length === 1 && !type.signed;
    }

    function decodeUint8Array(data: DataView, type: CArrayType): Uint8Array {
        if (!isUint8(type.elementType))
            throw new Error("Expected uint8_t array");
        // slicing the buffer to make a new copy
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteLength + data.byteLength));
    }

    function decodeArray(data: DataView, type: CArrayType): any[] | string | Uint8Array {
        if (isUint8(type.elementType))
            return decodeUint8Array(data, type);
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

    if (getSize(rootType) !== rawData.byteLength) {
        console.warn("Warning: Type size does not match with the given buffer size: ", getSize(rootType), " and ", rawData.byteLength);
        rawData = rawData.slice(0, getSize(rootType));
    }


    return decodeBuf(new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength), rootType);
}

export function getStructReader<GeneratedTypeMap extends Record<string, any>>(graph: CTypeGraph) {

    function size<T extends Extract<keyof GeneratedTypeMap, string>>(name: T) {
        const rootType: CStructType = {
            tag: CTypeTag.Struct,
            name
        };
        return getTypeSize(graph, rootType);
    }
    function decode<T extends Extract<keyof GeneratedTypeMap, string>>(data: Uint8Array, name: T): GeneratedTypeMap[T] {
        const rootType: CStructType = {
            tag: CTypeTag.Struct,
            name
        };
        return decodeData(graph, rootType, data) as any;
    }

    let buf: Uint8Array|null = null;
    async function read<T extends Extract<keyof GeneratedTypeMap, string>>(reader: BufReader, name: T): Promise<GeneratedTypeMap[T]> {
        const rootType: CStructType = {
            tag: CTypeTag.Struct,
            name
        };
        const size = getTypeSize(graph, rootType);
        buf = new Uint8Array(size);
        // It is past perfect (read it as "red") :)
        const read = await reader.readFull(buf);
        if (!read)
            throw new Error("Cannot read struct: " + JSON.stringify(name));
        return decode(read, name);
    }
    
    function getPreviousBuffer(){
        return buf;
    }
    return {
        size,
        decode,
        read,
        getPreviousBuffer
    }
}