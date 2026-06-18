# ThreadWise Product Plan

## 1. Product Definition

ThreadWise is a read-only AI conversation viewer for Gmail.

It is not a full email client. It does not send, reply to, archive, delete, label, mark as read, or otherwise modify Gmail messages.

Gmail remains the source of truth for email storage, sending, replying, and mailbox state. ThreadWise is a local-first intelligence and viewing layer that helps the user understand email conversations faster.

The core product experience is:

```text
Open app -> choose client -> choose topic -> understand thread instantly -> open Gmail if action is needed
```

The goal is to transform email from a message-centric inbox into a client-centric, conversation-centric workspace.

Instead of:

```text
Inbox -> Email -> Reply Chain
```

The user sees:

```text
Clients -> Mastercard -> Certificate Rotation -> Chat View + Summary + Actions + Context
```

## 2. Product Boundary

ThreadWise does:

- Read Gmail threads using read-only access.
- Clean and render email threads as chat-style conversations.
- Group conversations by client and topic.
- Summarize threads.
- Extract current status, decisions, and action items.
- Track who is waiting on whom.
- Show attachment metadata.
- Build searchable memory from email context.
- Let the user manually correct AI classifications and metadata.
- Open the original thread in Gmail when the user needs to reply or verify the source.

ThreadWise does not:

- Send email.
- Reply to email.
- Create drafts.
- Modify Gmail labels.
- Archive or delete messages.
- Mark messages as read or unread.
- Replace Gmail.
- Implement SMTP or IMAP in the MVP.

Core rule:

```text
ThreadWise is read-only by design. It may analyze and organize email data locally, but it must never send, modify, delete, archive, label, or mark Gmail messages as read/unread.
```

## 3. Core Problem

Traditional email clients organize information around:

- Inbox
- Subject
- Sender
- Timestamp
- Folders
- Labels

But professional work is usually understood through:

- Client
- Issue
- Project
- Status
- Responsibility
- Action items
- Decisions
- Attachments
- Historical context

This mismatch creates cognitive overload.

The main pain points are:

- Reply-all threads become hard to read.
- Nested quoted emails create visual noise.
- Multiple topics get mixed together.
- The latest status is hard to identify.
- It is unclear who needs to respond next.
- Attachments get buried.
- Decisions are hidden inside long email chains.
- Search depends on remembering exact keywords.
- There is no useful client-level dashboard.

## 4. Product Vision

ThreadWise should feel more like a mix of Slack, WhatsApp, Linear, and a lightweight CRM than like Gmail.

The app should answer these questions quickly:

- What is happening with each client?
- What needs my attention?
- What am I waiting on?
- What are clients waiting on from me?
- What is the latest status of this issue?
- What decisions were made?
- Where are the important attachments?
- What previous conversations are related?

The primary product promise is:

```text
The user should understand a messy email thread in less than 30 seconds.
```

## 5. Main UX Model

The app is organized as:

```text
Client -> Topic -> Thread -> Chat View -> Summary / Actions / Context
```

### 5.1 Client Dashboard

The main navigation is client-first.

Example clients:

- Mastercard
- KFH
- Visa
- Internal
- UAT Team
- Unknown / Unsorted

Each client card should show:

- Active thread count
- Unread count, if available from Gmail read-only data
- Waiting on me count
- Waiting on them count
- Last activity time

Example:

```text
Mastercard
3 active conversations
1 waiting on me
Last update: Today
```

### 5.2 Client Detail Page

Opening a client shows grouped conversations, not raw emails.

Example:

```text
Mastercard

Active Conversations

- Certificate Rotation
  Status: Waiting on Mastercard
  Priority: High
  Last updated: Today

- Android SDK Testing
  Status: Waiting on UAT
  Priority: Medium

- Token Delivery Failure
  Status: Investigation
  Priority: High
```

### 5.3 Thread Detail Page

Opening a conversation shows:

- AI summary
- Current status
- Open actions
- Decisions
- Timeline
- Attachments
- Chat-style email messages
- Raw email fallback
- Open in Gmail button

The default view should not show raw reply chains.

Example chat rendering:

```text
Ahmed
We rotated the certificate.

Vinod
Can you share the new public key?

You
Attached.

Mastercard
We are investigating.
```

Quoted history should be removed or collapsed unless it is clearly important.

## 6. AI Responsibilities

AI is responsible for understanding and structuring email conversations.

For each thread, AI should produce metadata like:

```json
{
  "client": "Mastercard",
  "topic": "Certificate Rotation",
  "category": "Production Issue",
  "status": "Waiting on Client",
  "priority": "High",
  "waiting_on": "Mastercard",
  "owner": "External",
  "summary": "Production certificate was changed, but Mastercard is rejecting requests with 401 Unauthorized.",
  "action_items": [
    {
      "description": "Mastercard must update the certificate on their side.",
      "owner": "Mastercard",
      "status": "open"
    },
    {
      "description": "Follow up if no confirmation is received.",
      "owner": "User",
      "status": "open"
    }
  ],
  "decisions": [
    "The certificate must be updated by Mastercard as well."
  ],
  "entities": [
    "Mastercard",
    "MDES",
    "certificate",
    "401 Unauthorized"
  ]
}
```

AI outputs must be editable. User corrections must persist and should override future AI reprocessing.

## 7. RAG Strategy

RAG is useful, but it should not block the first usable MVP.

There are three planned memory layers.

### 7.1 Message-Level Memory

Each cleaned email message can be embedded.

Used for:

- Semantic search
- Finding exact previous statements
- Answering detailed questions
- Locating older context

### 7.2 Thread-Level Memory

Each thread should have a structured memory object:

- Summary
- Timeline
- Decisions
- Actions
- Attachments
- Important people
- Current status
- Related entities

Used for:

- Fast thread understanding
- Dashboard rendering
- Status tracking

### 7.3 Client-Level Memory

Each client can have an aggregated profile:

- Known contacts
- Recurring systems
- Open issues
- Historical issues
- Previous decisions
- Common keywords
- Related domains

Example questions:

- What are all open Mastercard issues?
- What are we waiting for from Mastercard?
- Show all conversations related to certificates.
- Which threads mention notifyTokenUpdated?

## 8. Recommended Architecture

### 8.1 Frontend

Use:

- React
- TypeScript
- TailwindCSS
- TanStack Router
- TanStack Query

Desktop packaging can be added later with Tauri. The first version can be a local web app to reduce complexity.

### 8.2 Backend

Use:

- Node.js
- TypeScript
- Fastify
- SQLite
- Drizzle ORM

SQLite is preferred for MVP because it is local-first, simple, fast, and avoids external database setup.

### 8.3 Email Provider

Start with Gmail API only.

Use read-only Gmail scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

The app should:

- Authenticate with Google OAuth.
- Fetch Gmail threads.
- Fetch messages per thread.
- Store thread metadata locally.
- Store raw and cleaned message bodies locally.
- Store attachment metadata locally.
- Link back to the original Gmail thread.

The app should not request Gmail send, compose, insert, modify, or full mail scopes.

### 8.4 AI Provider

Use OpenAI API.

AI jobs:

- Clean message bodies.
- Remove quoted email noise.
- Classify threads.
- Generate summaries.
- Extract actions.
- Extract decisions.
- Extract entities.
- Generate embeddings later.

All AI outputs should be cached locally. Unchanged threads should not be reprocessed.

## 9. Data Model

### 9.1 clients

```sql
id
name
aliases_json
domains_json
confidence
source
notes
created_at
updated_at
```

### 9.2 email_threads

```sql
id
provider
provider_account_id
provider_thread_id
gmail_history_id
subject
client_id
topic
category
status
priority
waiting_on
owner
summary
classification_source
user_overridden
gmail_url
last_message_at
last_synced_at
ai_processed_at
ai_version
is_archived
created_at
updated_at
```

### 9.3 email_messages

```sql
id
thread_id
provider_message_id
message_hash
body_hash
sender_name
sender_email
recipient_json
cc_json
sent_at
gmail_internal_date
raw_body
clean_body
snippet
has_attachments
is_from_user
cleaning_status
cleaned_at
created_at
updated_at
```

### 9.4 thread_actions

```sql
id
thread_id
description
owner
status
due_date
source_message_id
source_quote
created_at
updated_at
```

### 9.5 thread_decisions

```sql
id
thread_id
decision
source_message_id
source_quote
created_at
updated_at
```

### 9.6 attachments

```sql
id
thread_id
message_id
filename
mime_type
size
provider_attachment_id
created_at
updated_at
```

### 9.7 embeddings

```sql
id
entity_type
entity_id
embedding
content
created_at
```

Entity type examples:

- message
- thread_summary
- client_memory

### 9.8 ai_jobs

```sql
id
job_type
entity_type
entity_id
status
input_hash
model
prompt_version
error
started_at
completed_at
created_at
```

### 9.9 user_corrections

```sql
id
entity_type
entity_id
field_name
old_value
new_value
created_at
```

## 10. Processing Pipeline

### Step 1: Gmail Sync

Fetch recent Gmail threads.

For each thread:

- Store provider thread ID.
- Store subject.
- Store messages.
- Store sender and recipient metadata.
- Store raw body.
- Store attachment metadata.
- Store Gmail deep link.

### Step 2: Message Cleaning

Clean each email message.

Remove:

- Quoted history
- Signatures where possible
- Legal disclaimers
- Repeated reply headers
- Excess formatting

Preserve:

- New message content
- Attachments
- Dates
- Senders
- Recipients
- Important quoted excerpts when clearly relevant

### Step 3: Thread Classification

Determine:

- Client
- Topic
- Category
- Status
- Priority
- Waiting on whom
- Related entities

Use hybrid classification:

- Known client domains
- Known aliases
- User corrections
- Rule-based matching
- AI fallback when confidence is low
- Unknown / Unsorted when unclear

Manual corrections must override AI.

### Step 4: Summary Generation

Generate:

- Short summary
- Current status
- Timeline
- Decisions
- Open actions
- Important entities
- Risks or blockers

### Step 5: Embedding

Later, embed:

- Cleaned messages
- Thread summaries
- Decisions
- Actions
- Client memory summaries

### Step 6: Client Memory Update

Later, update each client profile with:

- Common systems
- Active issues
- Recent blockers
- Known contacts
- Recurring technical entities

## 11. UI Screens

### 11.1 Client Dashboard

Purpose:

Show the user their work organized by client.

Components:

- Client list
- Active count
- Waiting on me count
- Waiting on others count
- Unread count if available
- Last update

### 11.2 Global Work Queues

Views:

- Waiting on Me
- Waiting on Others
- Active
- Unread
- Resolved
- Unknown / Unsorted

These views cut across all clients.

### 11.3 Client Detail

Shows:

- Client summary
- Open threads
- Resolved threads
- Known contacts
- Related entities
- Search within client

### 11.4 Thread Detail

Shows:

- Summary card
- Status
- Priority
- Waiting on
- Actions
- Decisions
- Timeline
- Attachments
- Chat view
- Raw email fallback
- Open in Gmail button

### 11.5 Semantic Search

The user can ask:

- What happened with the Mastercard certificate?
- What are we waiting for from KFH?
- Show all threads mentioning notifyTokenUpdated.
- Which production issues are still open?

Search should return conversations first, not individual emails.

## 12. Important UX Rules

- The app must not feel like Gmail.
- The app must not show raw reply chains by default.
- The app must prioritize conversations over messages.
- The app must organize by client first.
- AI output must be editable.
- User corrections must persist.
- Raw email must always be accessible as fallback.
- The user should understand a thread in under 30 seconds.
- Attachments should be visible without digging.
- Unknown items must be easy to reclassify.
- Replying or taking mailbox action must happen in Gmail, not ThreadWise.

## 13. MVP Scope

The MVP should build only the reading and understanding layer.

MVP includes:

- Gmail OAuth with read-only scope
- Gmail thread sync
- Local database
- Client grouping
- AI thread classification
- AI thread summary
- AI action extraction
- AI status extraction
- Chat-style message rendering
- Attachment list
- Waiting on Me
- Waiting on Others
- Unknown / Unsorted
- Manual reclassification
- Open in Gmail

MVP excludes:

- Sending emails
- Replies
- Draft creation
- Archive/delete/label actions
- Mark read/unread actions
- Full email client behavior
- Calendar integration
- Multi-provider support
- Team collaboration
- Mobile app
- Notification system
- IMAP
- SMTP

## 14. Recommended Implementation Phases

### Phase 0: Product Prototype Without Gmail

Goal:

Validate the core UX before dealing with Gmail OAuth and sync complexity.

Build:

- Seeded or imported email-like threads
- Client dashboard
- Client detail page
- Thread detail page
- Chat-style rendering
- AI summary/actions/status from sample data
- Manual correction UI
- Unknown / Unsorted queue

Success criteria:

```text
The product can demonstrate that messy email threads become understandable in under 30 seconds.
```

### Phase 1: Gmail Read-Only Ingestion

Goal:

Real Gmail data appears in the app.

Build:

- Google OAuth
- Read-only Gmail scope
- Gmail account connection
- Recent thread sync
- Message storage
- Attachment metadata
- Gmail deep links

Success criteria:

```text
The user can connect Gmail and see recent threads in ThreadWise without modifying Gmail.
```

### Phase 2: Cleaning and Chat Rendering

Goal:

Email threads become readable conversations.

Build:

- HTML to text extraction
- Quote removal
- Signature and disclaimer cleanup
- Chronological chat UI
- Raw email fallback

Success criteria:

```text
A messy reply-all chain becomes readable as a clean chat-style conversation.
```

### Phase 3: Client Classification

Goal:

Threads are grouped by client.

Build:

- Client model
- Manual client creation
- Domain aliases
- Keyword aliases
- Rule-based classification
- AI fallback classification
- Unknown / Unsorted queue
- Manual correction UI

Success criteria:

```text
Most threads are grouped under the correct client, and wrong classifications are easy to fix.
```

### Phase 4: AI Understanding

Goal:

The user understands a thread without reading it fully.

Build:

- Thread summary
- Current status
- Waiting-on detection
- Action item extraction
- Decision extraction
- Timeline extraction
- AI job cache
- Prompt versioning
- Source quotes for important actions and decisions

Success criteria:

```text
The thread detail page clearly explains what happened, what matters, and who needs to act.
```

### Phase 5: Work Queues

Goal:

The app becomes useful for daily work triage.

Build:

- Waiting on Me
- Waiting on Client
- Waiting on Internal Team
- Active
- Resolved
- Unknown
- Priority filters

Success criteria:

```text
The user can open ThreadWise and immediately know what needs attention.
```

### Phase 6: RAG and Search

Goal:

The user can retrieve knowledge across historical email context.

Build:

- Message embeddings
- Thread summary embeddings
- Semantic search
- Related threads
- Client memory
- Thread Q&A
- Client-level Q&A

Success criteria:

```text
The user can ask questions across old conversations without remembering exact keywords.
```

### Phase 7: Polish

Goal:

The app feels reliable enough for daily use.

Build:

- Better loading states
- Error handling
- Sync indicators
- Settings
- Privacy controls
- Keyboard shortcuts
- Better filters
- Local cache deletion
- Optional Tauri desktop packaging

## 15. Suggested AI Prompts

### 15.1 Thread Classifier Prompt

```text
You are an email workflow classifier.

Given a Gmail thread containing multiple cleaned messages, classify it into structured workflow metadata.

Return only valid JSON.

Fields:
- client
- topic
- category
- status
- priority
- waiting_on
- owner
- confidence
- reason
- entities

Rules:
- If the client is unclear, return "Unknown".
- Do not invent facts.
- Use sender domains, subject, message content, and prior known client context.
- Prefer concise topic names.
- Status must be one of:
  - Waiting on Me
  - Waiting on Client
  - Waiting on Internal Team
  - In Progress
  - Blocked
  - Resolved
  - Unknown
```

### 15.2 Thread Summary Prompt

```text
You are an email thread summarizer.

Given cleaned messages from a thread, produce:
- short_summary
- current_status
- timeline
- decisions
- open_actions
- important_entities
- risks_or_blockers

Return only valid JSON.

Rules:
- Do not include unnecessary details.
- Focus on the latest state.
- Separate facts from assumptions.
- If unclear, mark unclear.
- Do not hallucinate missing decisions.
- Include source message references when possible.
```

### 15.3 Message Cleaning Prompt

```text
Clean this email message for chat-style display.

Remove:
- quoted previous emails
- repeated reply headers
- signatures
- legal disclaimers
- duplicated content

Preserve:
- new message content
- direct answers
- technical details
- explicit decisions
- requested actions

Return only the cleaned message text.
```

## 16. Privacy and Security

Because ThreadWise processes email, security matters.

MVP rules:

- Use read-only Gmail OAuth scope only.
- Store data locally by default.
- Do not send raw email to AI unless necessary.
- Prefer sending cleaned thread chunks to AI.
- Allow AI processing to be disabled.
- Consider manual per-thread AI analysis for the first version.
- Cache AI results locally.
- Never expose OAuth tokens in frontend logs.
- Encrypt tokens at rest if possible.
- Allow the user to delete local cache.
- Make it clear that ThreadWise cannot send or modify email.

Recommended AI setting:

```text
AI Processing: Off / Analyze Manually / Analyze Synced Threads Automatically
```

## 17. Success Criteria

The MVP is successful if the user can:

- Connect Gmail with read-only access.
- See conversations grouped by client.
- Open a client and see active threads.
- Open a thread and read it like a chat.
- See a useful AI summary.
- See who is waiting on whom.
- Find action items without reading all emails.
- Correct wrong classifications.
- Open the source thread in Gmail.
- Avoid using ThreadWise for sending or mailbox management.

Primary success metric:

```text
The user should understand a messy email thread in less than 30 seconds.
```

## 18. Product Name Ideas

Working names:

- ThreadWise
- ClientMail
- Convoy
- InboxLayer
- ThreadOS
- MailLens
- ContextMail
- Relay
- SignalDesk
- ClientFlow

Current working title:

```text
ThreadWise
```

## 19. First Build Recommendation

Start with Phase 0.

Build a local prototype with seeded email data before adding Gmail.

The first milestone should be:

```text
A local web app that demonstrates the target read-only experience: client dashboard, client detail, thread detail, chat rendering, summaries, actions, decisions, manual correction, and open-in-Gmail placeholder.
```

This proves the product experience before investing in Gmail OAuth, sync, and AI pipeline complexity.
