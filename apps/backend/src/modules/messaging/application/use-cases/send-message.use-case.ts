import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ConversationId, FileId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { detectImageMimeType } from '@modules/files/domain/services/image-signature.detector';
import { Message } from '../../domain/entities/message.entity';
import { MessageSentEvent } from '../../domain/events/messaging.events';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import {
  MessageRepository,
  MESSAGE_REPOSITORY,
} from '../../domain/repositories/message.repository';
import { MessageAttachmentFileTooLargeException } from '../../domain/exceptions/message-attachment-file-too-large.exception';
import { UnsupportedMessageAttachmentFileTypeException } from '../../domain/exceptions/unsupported-message-attachment-file-type.exception';
import { InvalidMessageAttachmentFileException } from '../../domain/exceptions/invalid-message-attachment-file.exception';
import { MessageAttachmentStorageUnavailableException } from '../../domain/exceptions/message-attachment-storage-unavailable.exception';
import {
  MESSAGE_ATTACHMENT_EXTENSION_BY_MIME_TYPE,
  MESSAGE_ATTACHMENT_MAX_SIZE_BYTES,
  isAllowedMessageAttachmentMimeType,
} from '../policies/message-attachment-upload.policy';
import { MESSAGE_ATTACHMENTS_BUCKET } from '../../domain/tokens/messaging.tokens';
import { ConversationAccessService } from '../services/conversation-access.service';
import { ConversationParticipantResolverService } from '../services/conversation-participant-resolver.service';
import { resolveMessageSender } from '../services/assert-actor-can-manage-conversation';
import { toMessageResult } from '../mappers/message-result.mapper';
import { SendMessageCommand, UploadedMessageAttachmentFile } from '../dto/send-message.command';
import { MessageResult } from '../dto/message.result';

/**
 * `POST /conversations/:id/messages` - Shared. Rate limiting (D8) and
 * Idempotency-Key replay (D12) are both applied at the HTTP layer
 * (`MessagingSendRateLimitGuard`/`IdempotencyInterceptor`), not here - this
 * use case is the idempotent-command target they wrap, not where those
 * concerns are enforced.
 *
 * DECISIONS.md D7 - an inline attachment upload (no separate endpoint,
 * Step 10's fixed API surface) reuses the existing Files/MinIO pipeline
 * exactly like `AddReviewImageUseCase`: validate -> upload -> `FileRecord`
 * (`ownerType: 'Message'`, `ownerId` = the new Message's own id) ->
 * compensate on any downstream failure. No virus scanning (explicit
 * non-goal).
 */
@Injectable()
export class SendMessageUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepository: MessageRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(MESSAGE_ATTACHMENTS_BUCKET) private readonly bucket: string,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly conversationAccess: ConversationAccessService,
    private readonly participantResolver: ConversationParticipantResolverService,
  ) {}

  async execute(command: SendMessageCommand): Promise<MessageResult> {
    const conversationId = ConversationId.create(command.conversationId);
    const { conversation, isCustomer } = await this.conversationAccess.loadAuthorized(
      conversationId,
      command.actor,
    );

    if (isCustomer) {
      await this.participantResolver.resolveCustomer(
        conversationId,
        UserId.create(command.actor.userId),
      );
    } else if (command.actor.actorType !== AccessTokenActorType.User) {
      await this.participantResolver.resolveStaff(conversationId, command.actor);
    }

    const { senderType, senderUserId, senderEmployeeId } = resolveMessageSender(command.actor);
    const now = this.clock.now();
    const messageId = this.idGenerator.generate();

    const attachment = await this.uploadAttachmentIfPresent(
      messageId,
      command.attachment ?? null,
      now,
    );

    const message = Message.create({
      id: messageId,
      conversationId: conversationId.value,
      senderType,
      senderUserId,
      senderEmployeeId,
      body: command.body,
      messageType: command.messageType,
      attachmentFileId: attachment?.fileId.value ?? null,
      now,
    });

    // DECISIONS.md D5 - auto-reopen from either actor side, unconditional.
    const reopened = conversation.recordMessageSent(now);

    try {
      await this.unitOfWork.execute(async () => {
        await this.messageRepository.create(message);
        await this.conversationRepository.update(reopened);
      });
    } catch (error) {
      if (attachment !== null) {
        await this.compensateUpload(attachment.objectKey);
      }
      throw error;
    }

    await this.eventPublisher.publish(
      new MessageSentEvent(
        this.idGenerator.generate(),
        {
          conversationId: conversationId.value,
          restaurantId: conversation.restaurantId.value,
          branchId: conversation.branchId?.value ?? null,
          messageId: message.messageId.value,
          senderType,
          senderUserId,
          senderEmployeeId,
          body: message.body,
          messageType: message.messageType,
          attachmentFileId: message.attachmentFileId?.value ?? null,
          correlationId: command.correlationId,
        },
        now,
        command.correlationId,
      ),
    );

    return toMessageResult(message);
  }

  private async uploadAttachmentIfPresent(
    messageId: string,
    attachment: UploadedMessageAttachmentFile | null,
    now: Date,
  ): Promise<{ fileId: FileId; objectKey: string } | null> {
    if (attachment === null) {
      return null;
    }

    if (attachment.sizeBytes <= 0 || attachment.buffer.length === 0) {
      throw new InvalidMessageAttachmentFileException();
    }
    if (attachment.sizeBytes > MESSAGE_ATTACHMENT_MAX_SIZE_BYTES) {
      throw new MessageAttachmentFileTooLargeException(MESSAGE_ATTACHMENT_MAX_SIZE_BYTES);
    }
    if (!isAllowedMessageAttachmentMimeType(attachment.mimeType)) {
      throw new UnsupportedMessageAttachmentFileTypeException(attachment.mimeType);
    }
    const detectedMimeType = detectImageMimeType(attachment.buffer);
    if (detectedMimeType === null || detectedMimeType !== attachment.mimeType) {
      throw new InvalidMessageAttachmentFileException();
    }

    const fileId = this.idGenerator.generate();
    const extension = MESSAGE_ATTACHMENT_EXTENSION_BY_MIME_TYPE[detectedMimeType];
    const objectKey = `messages/${messageId}/attachments/${fileId}.${extension}`;

    try {
      await this.storagePort.upload({
        bucket: this.bucket,
        objectKey,
        body: attachment.buffer,
        contentType: detectedMimeType,
        sizeBytes: attachment.sizeBytes,
      });
    } catch {
      throw new MessageAttachmentStorageUnavailableException();
    }

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: messageId,
      ownerType: 'Message',
      bucket: this.bucket,
      objectKey,
      mimeType: detectedMimeType,
      sizeBytes: attachment.sizeBytes,
      accessPolicy: 'Private',
      createdAt: now,
      deletedAt: null,
    });

    try {
      await this.fileRepository.create(fileRecord);
    } catch (error) {
      await this.compensateUpload(objectKey);
      throw error;
    }

    return { fileId: fileRecord.fileId, objectKey };
  }

  private async compensateUpload(objectKey: string): Promise<void> {
    try {
      await this.storagePort.delete(this.bucket, objectKey);
    } catch {
      // Best-effort compensation, mirrors AddReviewImageUseCase's own
      // precedent - an orphaned object with no DB reference is never
      // served, but should be surfaced for ops cleanup rather than
      // crashing a request that already failed.
    }
  }
}
