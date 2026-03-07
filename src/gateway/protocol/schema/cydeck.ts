import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const SessionRotateParamsSchema = Type.Object(
  {
    fromSessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ToolsMemorySearchParamsSchema = Type.Object(
  {
    query: NonEmptyString,
    sessionKey: Type.Optional(NonEmptyString),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    minScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

export const ToolsMemoryGetParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    from: Type.Optional(Type.Integer({ minimum: 1 })),
    lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
