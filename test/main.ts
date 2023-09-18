import decodeData from "../lib/binary-decoder.ts";
import parseCStructs, { CStructType, CTypeTag } from "../lib/struct-parser.ts";
import generateTypes from "../lib/type-generator.ts";

if (import.meta.main) {
  const f = "./schema";
  const src = await Deno.readTextFile(new URL(f + ".h", import.meta.url));

  const typeGraph = parseCStructs(src);

  await Deno.writeTextFile(
    new URL(f + ".graph.json", import.meta.url),
    JSON.stringify(typeGraph, null, 4),
  );

  const root: CStructType = {
    tag: CTypeTag.Struct,
    name: "test_t",
  };

  const typeDefs = generateTypes(typeGraph);
  await Deno.writeTextFile(new URL(f + ".d.ts", import.meta.url), typeDefs);

  const data = await Deno.readFile(new URL(f + ".bin", import.meta.url));
  const parsed = decodeData(typeGraph, root, data.buffer, true);

  await Deno.writeTextFile(
    new URL(f + ".json", import.meta.url),
    JSON.stringify(parsed, null, 4),
  );
}
