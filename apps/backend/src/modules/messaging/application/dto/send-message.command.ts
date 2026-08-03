import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { MessageType } from '../../domain/enums/messaging.enums';

/** DECISIONS.md D7 - raw bytes for an inline attachment upload, validated/stored by `SendMessageUseCase` itself (no separate upload endpoint, Step 10's fixed API surface). */
export interface UploadedMessageAttachmentFile {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface SendMessageCommand {
  actor: AuthenticatedActor;
  conversationId: string;
  body: string;
  messageType?: MessageType;
  attachment?: UploadedMessageAttachmentFile | null;
  correlationId?: string;
}
