import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const ContextSourceSchema = Type.Union([
  Type.Literal("clipboard"),
  Type.Literal("active_window"),
  Type.Literal("terminal"),
  Type.Literal("fs"),
  Type.Literal("editor"),
]);

const RedactionLevelSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("mask"),
  Type.Literal("hash"),
  Type.Literal("block"),
]);

const SuggestionActionSchema = Type.Union([
  Type.Literal("apply"),
  Type.Literal("dismiss"),
  Type.Literal("undo"),
  Type.Literal("explain"),
]);

const FeedbackActionSchema = Type.Union([
  Type.Literal("accept"),
  Type.Literal("dismiss"),
  Type.Literal("modify"),
  Type.Literal("ignore"),
]);

export const ContextEventSchema = Type.Object(
  {
    version: Type.Literal("context.event.v1"),
    eventId: NonEmptyString,
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
    source: ContextSourceSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
    redaction: Type.Object(
      {
        applied: Type.Boolean(),
        level: RedactionLevelSchema,
        reasons: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
    bounds: Type.Object(
      {
        bytes: Type.Integer({ minimum: 0 }),
        dropped: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const SuggestionCardSchema = Type.Object(
  {
    version: Type.Literal("suggestion.card.v1"),
    suggestionId: NonEmptyString,
    sessionKey: NonEmptyString,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    mode: Type.Union([Type.Literal("safe"), Type.Literal("flow")]),
    actions: Type.Array(SuggestionActionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    expiresAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SuggestionFeedbackSchema = Type.Object(
  {
    version: Type.Literal("suggestion.feedback.v1"),
    suggestionId: NonEmptyString,
    action: FeedbackActionSchema,
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);
