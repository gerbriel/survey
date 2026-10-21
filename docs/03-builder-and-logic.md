# 03. Builder, logic engine, renderer, validation

Builds on `00-decisions.md`. Owns: question types, the definition JSON stored in `survey_versions`, the logic engine, the shared validator module, the renderer, builder UX, publish flow, theming, and builder collaboration. Does not own: the submission route handler, upload transport, or partial-save endpoint (doc 02), table DDL and SQL function bodies (doc 01), workspace settings such as the footer toggle and pixel consent mode (doc 05, 00 R7).

Benchmark: Jotform Bronze/Silver and SurveyMonkey Advantage/Premier. That means conditional logic with and/or groups, skip and end-early logic, piping, calculations and quiz scoring, randomization, custom thank-you and redirect per outcome, file upload, e-signature, matrix questions, ranking, custom branding with logo, and saved templates. This is an internal tool: no feature here is gated by a plan.

## 1. Question and block types (v1)

"Storage" is the answers column used per `00-decisions` Response storage. Each type writes exactly one primary column. The only exception: choice types with an "Other" option write the chosen option id to their primary column and put the free text in `value_json.other`.

Choice answers store the stable option id (`option.id`), never the label, so label edits never break reports. Matrix rows and columns follow the same rule with their own `id`.

| Type | Captures | Storage | Features to support |
|---|---|---|---|
| `short_text` | One line | `value_text` | placeholder, min/max length, regex with custom message, input mask (v1: digits/letters pattern) |
| `long_text` | Paragraph | `value_text` | min/max length, row count, character counter |
| `email` | Email | `value_text` (lowercased, trimmed) | can be identity key, confirm-entry field, allowed/blocked domains |
| `phone` | Phone | `value_text` (E.164) | default country, can be secondary identity key |
| `number` | Number | `value_number` | min/max, integer only, decimal places, prefix/suffix (currency display only) |
| `single_choice` | One option | `value_text` (option id) | option images, Other with text, randomize (pin "Other"/"None" last), per-option score, columns layout |
| `multiple_choice` | Many options | `value_json` (`string[]` of option ids) | min/max selections, exclusive option ("None of the above"), Other, randomize, scores |
| `dropdown` | One option, long list | `value_text` | searchable, bulk paste options, randomize, scores |
| `yes_no` | Boolean | `value_number` (1 or 0) | custom labels, score |
| `rating` | Scale value | `value_number` | 3 to 10 points, stars/numbers/emoji/slider display, end labels, score = value |
| `nps` | 0 to 10 | `value_number` | fixed scale, custom end labels, auto-category in reports (doc 04) |
| `matrix` (Likert) | One choice per row | `value_json` (`{ [row_id]: column_id }`) | rows and columns with ids, per-row required, randomize rows, column scores |
| `ranking` | Ordered list | `value_json` (`string[]` of option ids, rank 1 first) | drag and keyboard reorder, randomize initial order, "rank top N only" |
| `date` | Date | `value_date` | min/max date, relative bounds (no past dates), disabled weekdays, format display |
| `time` | Time of day | `value_text` (`HH:MM` 24h) | min/max, minute step |
| `file_upload` | Files | `value_json` (`FileRef[]`) | allowed extensions, max size per file, max file count |
| `signature` | Drawn signature | `value_json` (`FileRef`, PNG) | pen color, clear button, required |
| `address` | Postal address | `value_json` (`{line1,line2,city,region,postal,country}`) | per-part required, country default and lock |
| `consent` | Agreement | `value_number` (1 or 0) | workspace-defined text (from privacy settings) or custom rich text with links, must-be-checked, `gates_tracking` (pixel consent, see 2.1) |
| `hidden` | URL param value | `value_text` | param name, default value, usable in logic and piping |
| `calculated` | Computed number | `value_number` | formula, display or hide, used for quiz score |
| `page_break` | Not a question | none | pages are the structure, see `Page` |
| `statement` | Text block | none | rich text, piping |
| `image` | Image block | none | Storage image, alt text (required), width, link |

`FileRef = { path: string; name: string; size: number; mime: string }`. Upload transport and Storage bucket rules are doc 02.

Pushed to v2:
- **Multi-column matrix** (dropdown or text per cell). Storage and reporting shape is much heavier; Likert covers the common case.
- **Constant sum** and **slider with multiple handles**. Low demand, needs custom reporting.
- **Image choice as its own type**. Covered by option images on choice types.
- **Audio/video recording, geolocation, captcha question**. Device permission and storage cost. Turnstile already handles bots.
- **Multi-language surveys**. Translation storage per string doubles the editor surface. See open questions.
- **Payments, appointments, product lists**. Out of scope for good per 00.

## 2. Definition schema

This JSON is `survey_versions.definition`. All ids are short nanoids with prefixes (`p_`, `q_`, `o_`, `r_`, `c_`, `e_`, `l_`) and are stable inside a survey across versions (a draft copy keeps ids). Pure JSON: no functions, no Dates (ISO strings only), no undefined (omit keys).

```ts
export const CURRENT_SCHEMA_VERSION = 1 as const;

export interface SurveyDefinition {
  schema_version: 1;
  settings: SurveySettings;
  theme: Theme;                     // resolved at edit time over workspace defaults, see section 8
  pages: Page[];                    // order = page order
  questions: Record<string, Question>; // keyed by question id; order lives in Page.question_ids
  logic: LogicRule[];
  endings: Ending[];                // at least one; endings[0] is the default thank-you
  closed_message: RichText;
  identity: { email_question_id?: string; phone_question_id?: string };
  pixel_exclusions: string[];       // workspace pixel ids deselected for this survey (doc 02 owns pixels)
}

export interface SurveySettings {
  title: string;                    // public page title
  description?: RichText;
  show_progress: boolean;
  show_question_numbers: boolean;
  allow_back: boolean;
  one_question_per_screen: boolean; // renders each question as its own step inside a page
  randomize_pages?: { page_ids: string[] }; // subset only; first and last pages normally pinned
  autosave_partial: boolean;        // default true
  quiz?: { score_calc_id: string; show_correct_answers: boolean };
  trust_hidden_identity: boolean;   // default false; lets ?email= / ?contact= link a contact (00 R6, doc 04)
}

export type RichText = { format: 'md-lite'; text: string }; // bold, italic, links, line breaks, piping tokens

export interface Page {
  id: string;
  title?: string;
  description?: RichText;
  question_ids: string[];
  randomize_questions?: { pinned_ids: string[] }; // shuffle all except pinned (which keep position)
  button_label?: string;            // overrides theme.button_text.next
}

export type QuestionType =
  | 'short_text' | 'long_text' | 'email' | 'phone' | 'number'
  | 'single_choice' | 'multiple_choice' | 'dropdown' | 'yes_no'
  | 'rating' | 'nps' | 'matrix' | 'ranking' | 'date' | 'time'
  | 'file_upload' | 'signature' | 'address' | 'consent'
  | 'hidden' | 'calculated' | 'statement' | 'image';

export interface QuestionBase<T extends QuestionType, S> {
  id: string;
  question_key: string;             // snake_case, unique within the survey, see section 6
  type: T;
  label: RichText;                  // may contain piping tokens
  help?: RichText;
  required: boolean;                // ignored for display-only types
  validation?: Validation;
  contact_field?: ContactFieldTarget; // which contact column this answer fills (doc 04 2.3)
  pii?: boolean;                    // personal data; anonymize deletes it (doc 04 7.4)
  settings: S;
}

export type ContactFieldTarget =
  | { kind: 'core'; field: 'first_name' | 'last_name' | 'company' | 'phone' }
  | { kind: 'custom'; key: string };  // contact_field_defs.key

export interface ChoiceOption {
  id: string;                       // o_xxx, the option id, stored in answers
  label: string;
  export_value?: string;            // what CSV exports show, defaults to label
  image_path?: string;
  score?: number;                   // server only (2.1)
  is_other?: boolean;               // shows a text input
  is_exclusive?: boolean;           // multiple_choice: clears other selections
  pin_last?: boolean;               // not shuffled
}

export interface Validation {
  min_length?: number; max_length?: number;
  pattern?: { regex: string; flags?: 'i'; message: string }; // RE2-safe subset, checked at publish
  min?: number; max?: number; integer?: boolean;
  min_date?: string | { relative_days: number }; max_date?: string | { relative_days: number };
  min_selections?: number; max_selections?: number;
  allowed_extensions?: string[];    // lowercase, no dot
  max_file_mb?: number; max_files?: number;
  allowed_email_domains?: string[]; blocked_email_domains?: string[];
}

export type Question =
  | QuestionBase<'short_text', { placeholder?: string; mask?: string }>
  | QuestionBase<'long_text', { placeholder?: string; rows?: number }>
  | QuestionBase<'email', { placeholder?: string; confirm?: boolean }>
  | QuestionBase<'phone', { default_country: string }>
  | QuestionBase<'number', { decimals?: number; prefix?: string; suffix?: string }>
  | QuestionBase<'single_choice' | 'dropdown', { options: ChoiceOption[]; randomize: boolean; layout?: 'list' | 'columns'; searchable?: boolean; correct_option_id?: string }>
  | QuestionBase<'multiple_choice', { options: ChoiceOption[]; randomize: boolean; correct_option_ids?: string[] }>
  | QuestionBase<'yes_no', { yes_label: string; no_label: string; yes_score?: number; no_score?: number }>
  | QuestionBase<'rating', { points: number; display: 'stars' | 'numbers' | 'emoji' | 'slider'; min_label?: string; max_label?: string }>
  | QuestionBase<'nps', { min_label?: string; max_label?: string }>
  | QuestionBase<'matrix', { rows: { id: string; label: string }[]; columns: { id: string; label: string; score?: number }[]; randomize_rows: boolean; all_rows_required: boolean }>
  | QuestionBase<'ranking', { options: ChoiceOption[]; randomize: boolean; rank_top_n?: number }>
  | QuestionBase<'date', { display_format: 'MDY' | 'DMY' | 'YMD'; disabled_weekdays?: number[] }>
  | QuestionBase<'time', { minute_step: number }>
  | QuestionBase<'file_upload', Record<string, never>>
  | QuestionBase<'signature', { pen_color?: string }>
  | QuestionBase<'address', { parts_required: Partial<Record<'line1'|'line2'|'city'|'region'|'postal'|'country', boolean>>; default_country?: string; lock_country?: boolean }>
  | QuestionBase<'consent', { text_source: 'workspace' | 'custom'; custom_text?: RichText; gates_tracking: boolean }>
  | QuestionBase<'hidden', { param: string; default_value?: string }>
  | QuestionBase<'calculated', { formula: Expr; formula_source: string; visible: boolean; decimals?: number }>
  | QuestionBase<'statement', { body: RichText }>
  | QuestionBase<'image', { path: string; alt: string; width: 'small' | 'medium' | 'full'; href?: string }>;

export interface Ending {
  id: string;
  title?: RichText;
  message: RichText;                // piping allowed, e.g. "You scored {{calc:quiz_score}}"
  redirect_url?: string;            // http(s) only, may pipe tokens (URL-encoded); set means redirect after the message
  redirect_delay_seconds?: number;  // default 0
  redirect_pass_params?: boolean;   // append the original query string
  show_score: boolean;              // quiz score from the submit result, never computed in the browser
  show_summary: boolean;            // list the respondent's own answers on the ending screen
}
```

`consent` with `text_source: 'workspace'` snapshots the workspace text into `custom_text` at publish, so a frozen version shows exactly what the respondent agreed to.

`consent.gates_tracking`: when the workspace `pixel_consent_mode` is `in_form` (00 R7), pixels load only after a consent block with `gates_tracking: true` is checked. In other modes the flag is ignored. A tracking consent block is normally not `required`, so declining tracking never blocks submission. The linter warns (does not block) when the mode is `in_form`, the survey loads at least one pixel, and no consent block gates tracking.

`contact_field` and `pii` (requested by doc 04): `contact_field` is allowed on `short_text`, `phone`, `email` (custom fields only, the identity question already sets email), `number`, `date`, `single_choice`, `dropdown`, and `yes_no`; the linter checks that a custom key exists in `contact_field_defs` and that the types are compatible. Mapped answers fill empty contact fields only (doc 04). `pii` defaults to true for `address` and `signature`, false otherwise. Doc 04 treats identity, email, phone, and contact-mapped questions as personal data regardless of the flag.

`trust_hidden_identity` lives in survey settings for the builder UI; doc 01 stores it on `surveys` and doc 04 owns the resolution rules.

### 2.1 Server-only fields and `splitDefinition`

Some parts of a definition must never reach the browser, because they would let a respondent read quiz answers or game a score:

| Field | Where |
|---|---|
| Per-option scores | `ChoiceOption.score` on single choice, dropdown, multiple choice, ranking |
| Correct answers | `correct_option_id`, `correct_option_ids` |
| Yes/no scores | `yes_score`, `no_score` |
| Matrix column scores | `columns[].score` |
| Scored calcs | any `calculated` question whose formula uses `score` or `correct`, directly or through another calc. Removed whole (question and its page entry) |
| Scoring thresholds | `set_ending` rules whose condition references a scored calc |

Everything else (labels, options, validation, unscored logic, endings, theme) is public. Endings stay public because the browser must render them; which one shows is decided by the server when scoring is involved.

```ts
export interface ServerOnly {
  option_scores: Record<string, Record<string, number>>;  // question id -> option id -> score
  correct: Record<string, string | string[]>;              // question id -> option id(s)
  yes_no_scores: Record<string, { yes?: number; no?: number }>;
  matrix_column_scores: Record<string, Record<string, number>>; // question id -> column id -> score
  scored_calcs: Record<string, Question>;                  // full calculated questions
  scored_rules: LogicRule[];                               // stripped set_ending rules
}

// Pure, deterministic, lives in src/lib/survey-engine/split.ts
export function splitDefinition(definition: SurveyDefinition): {
  public_definition: SurveyDefinition;  // same type, server-only fields omitted
  server_only: ServerOnly;
};
```

- **Publish** runs `splitDefinition` on the server and stores `public_definition` on the version (00 R9). The anon read path `get_public_definition` returns only that column.
- **Server validator** receives the full `definition` and uses `splitDefinition(definition).server_only` to know which calcs are scored: their values are computed only on the server, returned in `computed` only for `settings.quiz.score_calc_id`, and returned to the browser only in the submit result. Scores are persisted by `submit_response` (00 R9).
- **Lint rules this implies**: scored calcs must be `visible: false`; scored calcs may be referenced only by `set_ending` rules and by ending piping, never by `show_*`, `jump`, or page piping (the browser could not evaluate them).
- **Correct answers shown to respondents** (`quiz.show_correct_answers`) come back in the submit result, never in the public definition.
- A unit test walks a fixture with every server-only field and asserts none survive in `public_definition`.

Schema evolution: `migrateDefinition(json): SurveyDefinition` upgrades any older `schema_version` in memory, step by step. Frozen rows are never rewritten. The validator and renderer always call it first.

## 3. Logic engine

### Conditions

```ts
export type Operand = string | number | boolean | string[] | null;

export type Operator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'matches'
  | 'is_answered' | 'is_not_answered'
  | 'includes_any' | 'includes_all' | 'includes_none'   // multiple_choice, file count n/a
  | 'before' | 'after' | 'on';                         // date

export interface Leaf {
  field: { kind: 'question'; id: string; row_id?: string } // row_id for matrix rows
       | { kind: 'hidden'; param: string }
       | { kind: 'calc'; id: string };
  op: Operator;
  value?: Operand;
}
export type Condition = Leaf | { all: Condition[] } | { any: Condition[] } | { not: Condition };
```

Operators allowed per type are a static table in the engine (`operatorsFor(type)`), used by both the editor dropdowns and the publish linter. Comparison is type-aware: choice ops compare option ids, numbers compare numerically, dates compare ISO strings, text comparisons are case-insensitive and trimmed. Unanswered fields make every op false except `is_not_answered`, `neq`, and `includes_none`.

### Rules

```ts
export type LogicRule =
  | { id: string; kind: 'show_question'; target_id: string; when: Condition }  // hidden unless when=true
  | { id: string; kind: 'hide_question'; target_id: string; when: Condition }
  | { id: string; kind: 'show_page'; target_id: string; when: Condition }      // page skipped unless true
  | { id: string; kind: 'jump'; from_page_id: string; to: { page_id: string } | { ending_id: string }; when: Condition; order: number }
  | { id: string; kind: 'set_ending'; ending_id: string; when: Condition; order: number }; // which ending shows at natural end
```

- **Show/hide**: a question with any `show_question` rule is hidden by default. If it also has `hide_question` rules, hide wins.
- **Skip logic**: `jump` rules on a page run when the respondent leaves it. Lowest `order` matching rule wins. Targets must be later pages (no loops); the linter blocks backward jumps.
- **End early**: `jump` to an `ending_id` ends the survey and submits as complete with that ending.
- **Endings at natural end**: `set_ending` rules, first match by order, else `endings[0]`.

### Piping

Token syntax inside any `RichText`, option labels, and ending redirect URLs:

```
{{q:question_key}}            answer of an earlier question
{{q:question_key|fallback}}   fallback text when unanswered or hidden
{{hidden:param}}              hidden field value
{{calc:question_key}}         calculated value, formatted with its decimals
```

Rendering rules: choice answers pipe the option label; multiple choice joins labels with ", "; matrix and file types are not pipeable (linter error). Piped values are inserted as escaped text, never as markup. Tokens may only reference questions on earlier pages (or hidden/calc), since the value must exist before the label renders. Scored calcs pipe only into endings, filled from the submit result (2.1). In redirect URLs values are URL-encoded.

### Calculated fields and scoring

The builder accepts a formula string such as `{{q:age}} * 12 + score({{q:quiz_1}}, {{q:quiz_2}})`. It is parsed at edit time into an AST and both are stored (`formula_source` for editing, `formula` for evaluation). No `eval` ever.

```ts
export type Expr =
  | { num: number }
  | { ref: { kind: 'question' | 'hidden' | 'calc'; id: string } }  // numeric value, unanswered = 0
  | { op: '+' | '-' | '*' | '/' | 'min' | 'max'; args: Expr[] }     // divide by zero = 0
  | { fn: 'score'; ids: string[] }      // sum of option/column/yes_no scores across these questions
  | { fn: 'correct'; ids: string[] }    // count of questions answered correctly
  | { fn: 'round'; arg: Expr; places: number }
  | { fn: 'if'; cond: Condition; then: Expr; else: Expr };
```

Quiz mode is a calculated question named in `settings.quiz.score_calc_id`. Calcs may reference other calcs; the graph must be acyclic (linter).

### Randomization

Shuffles use a seeded PRNG (mulberry32) with `seed = hash(response_seed + target_id)`. `response_seed` is generated when the respondent starts, stored in `responses.metadata.random_seed`, and reused on resume, so order is stable across reloads and visible to exports. Pinned options (`pin_last`, Other, exclusive) and `pinned_ids` keep their positions. Randomization never affects validation.

### Evaluation order

`evaluate(definition, answers, context)` is a pure function returning an `EvalState`. Steps, every time an answer changes:

1. Normalize answers (trim, lowercase email, coerce types). Drop answers for unknown ids.
2. Inject hidden fields from `context.hidden`, applying defaults.
3. Compute calculated fields in topological order.
4. Walk pages from the first: a page is on the path if its `show_page` rules pass (or it has none). For each page on the path compute question visibility. Answers to hidden questions are treated as absent for every later step (conditions, piping, calcs are recomputed after this; the walk iterates until stable, max 3 passes, since calcs can depend on visibility).
5. On leaving each page, evaluate its `jump` rules. A jump skips intermediate pages; a jump to an ending terminates the path.
6. If the path reaches the end, evaluate `set_ending`.

Output: `{ path: string[]; visible: Set<questionId>; calcs: Record<id, number>; ending_id: string | null; ended_early: boolean }`.

### Same engine on client and server

The engine lives in `src/lib/survey-engine/` as framework-free TypeScript: no React, no DOM, no `Date.now()` (the current date comes from `context.now`), no randomness except the seeded PRNG, no network. The renderer imports it in the browser; the submission route handler imports the same files on Node. A single Vitest suite of fixture surveys runs against it, and an ESLint boundary rule blocks imports of `react`, `next`, or `@supabase` into that folder.

## 4. Shared validator

Module path: `src/lib/survey/validate.ts` (00 R4). It imports the engine from `src/lib/survey-engine/` and follows the same framework-free rule.

```ts
export interface ValidationContext {
  now: string;                        // ISO, server time on the server
  hidden: Record<string, string>;     // from URL / response metadata
  files: Record<string, FileRef[]>;   // server: upload manifest for this response (doc 02); client: local state
  mode: 'page' | 'partial' | 'final';
  page_id?: string;                   // required when mode = 'page'
}

export type ErrorCode =
  | 'required' | 'type' | 'min_length' | 'max_length' | 'pattern'
  | 'min' | 'max' | 'integer' | 'min_date' | 'max_date' | 'email' | 'phone'
  | 'min_selections' | 'max_selections' | 'unknown_option' | 'exclusive'
  | 'file_type' | 'file_size' | 'file_count' | 'file_unknown' | 'consent' | 'confirm_mismatch';

export interface ValidationError { code: ErrorCode; message: string; row_id?: string; part?: string }

export interface ValidateResult {
  ok: boolean;
  errors: Record<string, ValidationError[]>;  // keyed by question id
  cleaned: Record<string, AnswerValue>;       // only answers on the path and visible, normalized
  computed: Record<string, number>;           // calculated fields, server values are authoritative
  path: string[];
  ending_id: string | null;
}

export function validateSubmission(
  definition: SurveyDefinition, answers: Record<string, unknown>, context: ValidationContext
): ValidateResult;
```

Behavior:
- Runs `evaluate` first. Questions that are hidden or on pages off the path are never required and their submitted values are dropped from `cleaned` (not an error, since a respondent may have answered then changed a branch).
- `mode: 'page'` checks only the visible questions of `page_id`; the renderer calls it on Next. `mode: 'partial'` checks types and bounds but not `required`. `mode: 'final'` checks everything on the path. The submission route handler (doc 02) maps its `save` action to `partial` and `complete` to `final`.
- The browser calls it with `public_definition`; the server calls it with the full `definition` (2.1). Results agree on everything except scored calcs, which only the server computes.
- Client-submitted values for `calculated` questions are ignored and recomputed.
- Choice values must be existing option ids (matrix: existing row and column ids). File refs must exist in `context.files` (the server passes only files uploaded under this response), matching extension, size, and count.
- Messages are English defaults from a message table keyed by `ErrorCode`, interpolating limits. A custom `pattern.message` overrides.
- Regexes are checked at publish for catastrophic backtracking (no nested quantifiers) and length limit 200.

`AnswerValue` maps one to one to the storage column in section 1. A helper `toAnswerRow(question, value)` returns `{ value_text | value_number | value_date | value_json }` so the SQL write function (doc 01/02) never guesses.

## 5. Renderer architecture

One client component tree, `<SurveyRenderer>`, used by the builder preview, the public page, and template thumbnails.

```ts
interface SurveyRendererProps {
  definition: SurveyDefinition;
  mode: 'live' | 'preview';
  initial?: { answers: Record<string, unknown>; page_id?: string; seed: string }; // resume
  hidden: Record<string, string>;
  workspaceAssets: { logo_url?: string; show_powered_by: boolean }; // footer is a workspace toggle (00)
  onAutosave?: (snapshot: PartialSnapshot) => Promise<void>;   // live only
  onSubmit?: (payload: SubmitPayload) => Promise<SubmitResult>; // live only
}
```

- **Tree**: `SurveyRenderer > ThemeProvider > SurveyShell (logo, cover, progress, footer) > PageView > QuestionFrame > {TypeComponent}`. Type components come from a registry `Record<QuestionType, { Input, defaultSettings, emptyValue }>` shared with the builder palette.
- **State**: `useSurveyState` is a reducer holding `answers`, `current_page_id`, `history` (for Back), `touched`, `errors`. Every change reruns `evaluate` (memoized). Inputs are fully controlled.
- **Navigation**: Next calls `validateSubmission` in `page` mode, then follows the engine path. Back pops `history`. `one_question_per_screen` steps through visible questions inside a page with the same rules.
- **Autosave**: `useAutosave` debounces 2 seconds after the last change and fires on every page change, sending `{ answers, page_id, seed }` through `onAutosave`. The endpoint and resume credential are doc 02. Failures retry with backoff and never block the respondent.
- **Theme**: `ThemeProvider` writes the Theme as CSS custom properties on the root element (`--sv-primary`, `--sv-font`, and so on). Tailwind utilities reference those variables. Fonts load via `next/font` from the safe list. v1 supports the safe list only: no uploaded or arbitrary web fonts.
- **Preview mode**: no autosave, no submit, no pixels, no Turnstile, a "Preview" banner, and a "jump to page" debug menu showing current visibility and calc values. Logic runs exactly as live.
- **Server side**: the public page server component loads the `public_definition` through `get_public_definition` (00 R1), migrates it, then hydrates the renderer. The full definition never reaches the public page. Pixel injection stays outside the renderer (doc 02).
- **Accessibility**: every type is keyboard operable, labels bound to inputs, errors announced via `aria-live`. Ranking and signature have keyboard alternatives (move up/down buttons; typed name fallback is v2).

## 6. Builder UX

Layout: three panes on a route like `/w/{workspace}/surveys/{id}/edit`.

- **Left palette**: types grouped Text, Choice, Scale, Date and time, Upload, Contact, Layout, Advanced (hidden, calculated). Click to add after selection or drag onto the canvas.
- **Center canvas**: pages stacked vertically with page headers. Drag and drop (dnd-kit) reorders questions within and across pages and reorders pages. Inline editing of labels and options. Endings listed after the last page.
- **Right panel**: tabs "Settings" (required, help, type settings, a "Save to contact field" picker that sets `contact_field`, and a "Contains personal data" toggle that sets `pii`), "Validation", "Logic". Consent blocks add a "Gates tracking pixels" toggle (`gates_tracking`), with a hint when the workspace consent mode is not `in_form`. Page selected shows page settings and page logic. Nothing selected shows survey settings and theme.
- **Logic editor**: per question, a "Show this question when" builder: rows of field, operator, value with an All/Any toggle and nested groups (max depth 3). Per page, "After this page" jump rows in order and "Show this page when". A survey-level Logic overview lists every rule with broken-reference warnings. Field pickers only offer valid earlier questions.
- **Preview**: toggle desktop and mobile (390px frame) widths; opens the real renderer in preview mode in-place, plus "Open preview in new tab" with a short-lived signed preview URL.
- **Duplicate question**: new id, key gets a `_2` suffix (incrementing), options keep their option ids (they are scoped per question), logic rules targeting the original are not copied.
- **Duplicate survey**: copies the current draft (or a chosen published version) into a new survey in draft state with a new slug, preserving question ids and keys. No responses, tokens, or lock copied.
- **Templates**: `survey_templates(id, workspace_id nullable, name, description, definition, created_by, created_at)` rows (00 R8), `workspace_id` null for system templates. Starter set: Customer satisfaction (CSAT + NPS), Event feedback, Lead capture form, Employee pulse (Likert matrix), Product knowledge quiz (scoring + endings), Event registration. "Save as template" from any survey stores the definition in the workspace (editor and above).
- **Import from text**: paste box, one question per line. Rules: lines beginning with `-` or `*` under a question become options (single choice; `[multi]` at the end of the question line makes it multiple choice; `[dropdown]` likewise). `---` alone starts a new page. A trailing `*` marks required. Without options, the label is sniffed: contains "email" becomes email, "phone" becomes phone, "date" becomes date, "how likely" becomes NPS, else short text. A preview table lets the user fix types before inserting.
- **Undo/redo**: client-side only, per open editor session, 100 steps, stored as Immer patches. Typing in one field coalesces into one step after 1 second of idle. Covers all definition edits including logic and theme. Cleared on reload, publish, or lock loss. Not shared across users.

**Saving the draft**: the editor holds the definition in a client store and saves the whole JSON to the draft `survey_versions` row 1.5 seconds after the last change, passing the expected `revision` (00 R8). The save increments `revision`; a mismatch means someone took the lock, and the editor goes read-only. Max definition size 1 MB, max 300 questions per survey (00 global limits; a platform admin may override per workspace through `workspace_limits`).

**question_key rules**:
- Auto-generated from the label: lowercase, ASCII fold, non-alphanumerics to `_`, max 40 chars, deduped with `_2`, `_3`. Regenerates while the label is edited until the user edits the key by hand or the question is published.
- Must match `^[a-z][a-z0-9_]{0,39}$` and be unique within the survey.
- Freely editable until the question first appears in a published version. After that, editing shows a warning: "Reports will treat this as a new question. Past answers stay under the old key." A published key that was later deleted stays reserved for the survey and cannot be reused by a question of a different storage column.

## 7. Publish flow

Publishing goes through a server route. It loads the draft at the expected revision, runs the lint pass, runs `splitDefinition`, and saves `public_definition` onto the draft through the normal revision-guarded draft save. It then calls `publish_survey_version(p_version_id, p_expected_revision)` with the new revision. That SQL function, in one transaction: fails on a revision mismatch or a null `public_definition`, freezes the draft (sets `published_at`, immutable thereafter), writes the normalized `questions` snapshot, and inserts a new draft as a copy (revision 0, no lock). Publishing does not change survey state; a draft survey still needs "Open" (doc 02 owns states).

**Lint (blocks publish)**: broken references in logic, piping, calcs; backward or self jumps; calc cycles; piping of later or non-pipeable questions; invalid regex; empty choice options; duplicate question keys or option ids; identity question not of type email/phone; at least one ending; scored calc rules from 2.1; `contact_field` target missing or type incompatible; `redirect_url` not http(s). Warnings (do not block): `in_form` consent mode without a tracking consent block.

**Change classification** (diff of draft vs latest published, per `question_key`):

| Change | Class | Effect |
|---|---|---|
| Label, help, placeholder, option label, statement text, theme, endings, closed message | Safe | Reports span versions |
| Add question, add option, reorder, toggle required, loosen or tighten validation | Safe | Reports span versions |
| Logic rule changes | Safe, noted | Listed in dialog because they change who sees what |
| Remove option, remove matrix row/column | Breaking | Old answers keep the option id; reports show "(removed option)" |
| Rating points or scale bounds change | Breaking | Reports split by version for this key |
| Type change within the same storage column (single choice to dropdown, short to long text) | Safe | Same storage |
| Type change across storage columns | Breaking, forced new key | Builder assigns a new key (`_v2`) automatically; old key remains in history |
| question_key edit after publish | Breaking | Treated as a new question |
| Delete question | Breaking | Past answers remain under its key |

UI: breaking changes show an inline amber badge on the question as they are made, and the publish dialog lists Safe and Breaking groups with plain explanations. Breaking changes require ticking "I understand reports will split for these questions". If the survey has zero responses, breaking changes are shown as info only.

**Open partials**: a partial response stays bound to its `survey_version_id` and continues against that frozen definition, including on resume after a later publish. The public page loads the version referenced by the partial, not the latest. New respondents get the latest published version.

**Reopening a draft**: there is always exactly one draft per survey after the first publish. "Discard draft changes" replaces the draft definition with a copy of the latest published. "Restore version N" copies any published version into the draft (with a confirm). Version history lists each published version with publisher, time, and response count.

## 8. Theme and branding

Workspace settings hold a `Theme` default. A new survey copies it into `definition.theme`; "Reset to workspace theme" re-copies. Copying (not referencing) keeps frozen versions visually stable.

```ts
// v1: safe list only. No uploaded or arbitrary web fonts.
export type SafeFont = 'Inter' | 'Roboto' | 'Open Sans' | 'Lato' | 'Source Serif 4' | 'Merriweather' | 'Poppins' | 'Work Sans' | 'IBM Plex Sans' | 'system-ui';

export interface Theme {
  colors: {
    primary: string;      // buttons, selected states, progress fill (hex)
    text: string;
    muted_text: string;
    background: string;
    surface: string;      // card behind questions
    error: string;
  };
  font: { heading: SafeFont; body: SafeFont; base_size: 'sm' | 'md' | 'lg' };
  logo: { source: 'workspace' | 'none' | 'custom'; custom_path?: string; position: 'left' | 'center'; size: 'sm' | 'md' | 'lg' };
  cover_image?: { path: string; height: 'short' | 'tall'; focal_y: number };  // 0..1
  background: { kind: 'color' } | { kind: 'image'; path: string; overlay_opacity: number };
  button_text: { next: string; back: string; submit: string; start?: string };
  progress: { style: 'bar' | 'steps' | 'percent' | 'none'; position: 'top' | 'bottom' };
  corner_radius: 'none' | 'sm' | 'md' | 'lg';
  layout: 'card' | 'full';
}
```

`logo.source: 'workspace'` reads the workspace logo path at render time (the one exception to copy-in, because a rebrand should update live surveys). The theme editor warns when text/background contrast is below WCAG AA (4.5:1). Paths are Storage paths in the workspace bucket; bucket rules are doc 01/02.

## 9. Collaboration

**Lock** (on the draft version row, per 00):
- Opening the editor calls `take_draft_lock(p_version_id, p_force := false)` on the survey's draft version. Free or expired lock (`locked_at` older than 15 minutes), or already held by the caller: it takes or refreshes the lock. Held by someone else: the editor opens read-only with a banner "Maria is editing (active 3 min ago)" and a "Take over" button.
- `locked_at` refreshes on every draft save and on a 60 second heartbeat (`take_draft_lock(p_version_id, false)` again), but the heartbeat only refreshes if the user interacted (key, pointer) in the last 15 minutes. An idle tab therefore loses the lock at 15 minutes.
- Take over: confirm dialog "Maria may lose unsaved changes from the last few seconds." On confirm, `take_draft_lock(p_version_id, true)` moves the lock; Maria's next save fails the revision check, her editor flips to read-only with "Your editing session was taken over by Sam", and her undo stack is cleared. Viewers never see Take over.
- Closing the tab sends a best-effort `navigator.sendBeacon` to an app route that calls `release_draft_lock(p_version_id)`.

**Presence**: a Supabase Realtime presence channel `survey:{id}` shows avatars of members currently viewing the editor or results, with an "editing" badge on the lock holder. Presence is display only; the lock row is the authority. If Realtime is unavailable, the banner falls back to the lock row.

**activity_log** (`entity = 'survey'`, entity id = survey id):

| action | diff |
|---|---|
| `survey.created`, `survey.duplicated`, `survey.created_from_template`, `survey.deleted` | source ids |
| `survey.draft_edited` | coalesced: one row per editor per 10 minute window, listing question ids added, removed, changed, plus logic/theme/settings touched |
| `survey.published` | version id, version number, safe and breaking change list |
| `survey.draft_discarded`, `survey.version_restored` | version ids |
| `survey.lock_taken_over` | previous holder, new holder |
| `survey.imported_questions` | count |
| `template.saved`, `template.deleted` | template id |

Lock acquire, release, and heartbeat are not logged (noise).

## Decisions made here

- **One storage column per type, Other text in `value_json.other`**. Keeps reports simple while supporting Other.
- **Choice answers store option ids, not labels** (00 R5). Label edits become safe changes. Matrix rows and columns use `id` the same way.
- **Booleans (yes_no, consent) stored as `value_number` 1/0**. Aggregates (percent yes) become plain averages.
- **Time stored as `value_text` `HH:MM`**. `value_date` is a date; no time-zone ambiguity.
- **Hidden fields are also question entries and write answers**, in addition to response metadata. Makes them reportable and usable in logic per version.
- **Calculated fields are stored as answers and always recomputed on the server**. Client values are untrusted.
- **Question ids and option ids persist across versions** in a survey. Lets the diff and reports match without guessing.
- **Logic is AST JSON, formulas parsed at edit time, no eval**. Same evaluation on client and server, no injection risk.
- **Jumps only go forward**. No loops means the path walk always terminates.
- **Randomization seed stored in `responses.metadata.random_seed`**. Stable order on resume and auditable.
- **Partials resume on their original version**. Required by immutable versions.
- **Type change across storage columns forces a new question_key**. Prevents mixed types under one report key.
- **Theme copied into the definition, except the workspace logo which is referenced**. Frozen versions look stable, rebrands still update logos.
- **Draft saves and publish pass the expected `revision`** (00 R8, in doc 01). Detects lock take-over cleanly. Lock functions are `take_draft_lock(p_version_id, p_force)` and `release_draft_lock(p_version_id)`.
- **Server-only fields are stripped by one pure `splitDefinition`** used by publish and the server validator (00 R9). Scored calcs are hidden and computed only on the server.
- **Validator is `validateSubmission` at `src/lib/survey/validate.ts`** with modes `page`, `partial`, `final` (00 R4).
- **Endings carry `message`, `redirect_url`, `show_score`, `show_summary`** (doc 02 request). Score and correct answers come from the submit result.
- **Consent blocks carry `gates_tracking`**, effective only in the `in_form` pixel consent mode (00 R7).
- **Questions carry `contact_field` and `pii`** (doc 04 request). Mapping fills empty contact fields only.
- **The "Powered by" footer is a workspace toggle, not part of the definition** (00). The renderer reads it at render time.
- **Fonts: safe list only in v1.**
- **Engine folder is framework-free with a lint boundary**. Guarantees identical client and server behavior.
- **Workspace consent text is snapshotted at publish**. Proof of what was agreed to.
- **activity_log coalesces draft edits into 10 minute windows**. Every mutation is still recorded without one row per keystroke.
- **Supabase Realtime presence for viewers**. Part of Supabase, not a new vendor.
- **Caps: 300 questions, 1 MB definition, condition depth 3**. Protects renderer and validator performance.

## Open questions for the owner

1. Multi-language surveys are pushed to v2. Is any department blocked without them?
2. Is a signature from a drawn PNG enough for your departments, or do they need a legally styled e-sign audit trail (signer IP, timestamp certificate)? IP conflicts with the default of not storing IPs.
3. Should quiz mode show correct answers to respondents by default, or only the score?
4. Do you want a "save and continue later" link the respondent can copy, beyond automatic resume in the same browser? Doc 02 would own the credential.
5. Are the starter system templates enough, or do you want department packs (HR, events, training)?
6. Should viewers be able to open the builder preview, or only the public link?
