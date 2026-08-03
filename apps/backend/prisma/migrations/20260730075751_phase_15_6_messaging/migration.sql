-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('Open', 'Closed', 'Archived');

-- CreateEnum
CREATE TYPE "ConversationParticipantRole" AS ENUM ('Customer', 'Staff', 'System');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('Customer', 'Employee', 'OrganizationMember', 'System');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('Text', 'System', 'Attachment');

-- AlterEnum
ALTER TYPE "FileOwnerType" ADD VALUE 'Message';

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID,
    "reservation_id" UUID,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'Open',
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_id" UUID,
    "role" "ConversationParticipantRole" NOT NULL,
    "last_read_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "MessageSenderType" NOT NULL,
    "sender_user_id" UUID,
    "sender_employee_id" UUID,
    "body" TEXT NOT NULL,
    "message_type" "MessageType" NOT NULL DEFAULT 'Text',
    "attachment_file_id" UUID,
    "anonymized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_restaurant_id_idx" ON "conversations"("restaurant_id");

-- CreateIndex
CREATE INDEX "conversations_branch_id_idx" ON "conversations"("branch_id");

-- CreateIndex
CREATE INDEX "conversations_reservation_id_idx" ON "conversations"("reservation_id");

-- CreateIndex
CREATE INDEX "conversations_restaurant_id_last_message_at_idx" ON "conversations"("restaurant_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "conversation_participants_employee_id_idx" ON "conversation_participants"("employee_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_employee_id_fkey" FOREIGN KEY ("sender_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 15.6 (DECISIONS.md D2/D3, ADR-020 corrected by ADR-030): the two
-- participant/sender invariants below cannot be expressed in schema.prisma
-- (no partial WHERE support in @@unique, and a same-column XOR check),
-- mirroring the reservations_party_xor_chk / reservation_waitlist_entries
-- partial-unique-index precedents (Phase 7.4/7.5 migrations) exactly.

-- D2: a ConversationParticipant is either a Customer/OrganizationMember
-- (user_id set, employee_id null) or an Employee (employee_id set, user_id
-- null), never both, never neither unless role = 'System'. At most one
-- participant row per (conversation, user) and per (conversation, employee).
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_actor_xor_chk"
    CHECK (
        ("user_id" IS NOT NULL AND "employee_id" IS NULL)
        OR
        ("user_id" IS NULL AND "employee_id" IS NOT NULL)
        OR
        ("role" = 'System' AND "user_id" IS NULL AND "employee_id" IS NULL)
    );

CREATE UNIQUE INDEX "conversation_participants_conversation_id_user_id_key"
    ON "conversation_participants" ("conversation_id", "user_id")
    WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "conversation_participants_conversation_id_employee_id_key"
    ON "conversation_participants" ("conversation_id", "employee_id")
    WHERE "employee_id" IS NOT NULL;

-- D3: a Message sender is exactly one of sender_user_id (Customer or
-- OrganizationMember - Message.senderType disambiguates which, a DB CHECK
-- cannot) or sender_employee_id (Employee), never both, never neither
-- unless sender_type = 'System'.
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_xor_chk"
    CHECK (
        ("sender_user_id" IS NOT NULL AND "sender_employee_id" IS NULL)
        OR
        ("sender_user_id" IS NULL AND "sender_employee_id" IS NOT NULL)
        OR
        ("sender_type" = 'System' AND "sender_user_id" IS NULL AND "sender_employee_id" IS NULL)
    );
