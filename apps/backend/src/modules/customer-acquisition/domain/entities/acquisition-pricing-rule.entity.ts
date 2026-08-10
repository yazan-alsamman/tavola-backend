import { Entity } from '@shared/domain/base/entity.base';
import { AcquisitionPricingRuleId } from '@shared/domain/value-objects/identifiers.vo';
import { PricingFeeType, PricingScopeType } from '../enums/customer-acquisition.enums';
import { InvalidPricingRuleException } from '../exceptions/invalid-pricing-rule.exception';
import { PercentagePricingNotSupportedException } from '../exceptions/percentage-pricing-not-supported.exception';

export interface AcquisitionPricingRuleProps {
  id: string;
  scopeType: PricingScopeType;
  scopeId: string | null;
  feeType: PricingFeeType;
  flatAmount: number | null;
  flatCurrency: string | null;
  percentageValue: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  label: string;
  createdBy: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_LABEL_LENGTH = 200;

/**
 * Acquisition Pricing Rule (part of the Customer Acquisition bounded
 * context, not its own aggregate root - ADR-033 §14). A single table for
 * flat fee / restaurant override / organization override / campaign - all
 * the same primitive at different scope levels. Never edited in place
 * (§15) - a pricing change always creates a new row via `create()`; the
 * superseded row is archived separately (`archive()`), no combined
 * "replace" operation. `feeType = Percentage` is structurally defined but
 * application-rejected until a future ADR introduces a monetary base value
 * (§16, `PercentagePricingNotSupportedException`).
 */
export class AcquisitionPricingRule extends Entity<AcquisitionPricingRuleProps> {
  private constructor(props: AcquisitionPricingRuleProps) {
    super(props);
  }

  static create(props: {
    id: string;
    scopeType: PricingScopeType;
    scopeId: string | null;
    feeType: PricingFeeType;
    flatAmount: number | null;
    flatCurrency: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    label: string;
    createdBy: string;
    now: Date;
  }): AcquisitionPricingRule {
    validate(props);
    return new AcquisitionPricingRule({
      id: props.id,
      scopeType: props.scopeType,
      scopeId: props.scopeId,
      feeType: props.feeType,
      flatAmount: props.flatAmount,
      flatCurrency: props.flatCurrency,
      percentageValue: null,
      effectiveFrom: props.effectiveFrom,
      effectiveTo: props.effectiveTo,
      label: props.label,
      createdBy: props.createdBy,
      archivedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: AcquisitionPricingRuleProps): AcquisitionPricingRule {
    return new AcquisitionPricingRule({ ...props });
  }

  get ruleId(): AcquisitionPricingRuleId {
    return AcquisitionPricingRuleId.create(this.props.id);
  }

  get scopeType(): PricingScopeType {
    return this.props.scopeType;
  }

  get scopeId(): string | null {
    return this.props.scopeId;
  }

  get feeType(): PricingFeeType {
    return this.props.feeType;
  }

  get flatAmount(): number | null {
    return this.props.flatAmount;
  }

  get flatCurrency(): string | null {
    return this.props.flatCurrency;
  }

  get percentageValue(): number | null {
    return this.props.percentageValue;
  }

  get effectiveFrom(): Date {
    return new Date(this.props.effectiveFrom.getTime());
  }

  get effectiveTo(): Date | null {
    return this.props.effectiveTo ? new Date(this.props.effectiveTo.getTime()) : null;
  }

  get label(): string {
    return this.props.label;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt ? new Date(this.props.archivedAt.getTime()) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /**
   * §15 - "rollback" requires no new mechanism: archiving a mistaken rule
   * causes resolution to fall back to the next-most-recent still-active rule
   * automatically. A no-op (reference-equal return) if already archived,
   * mirroring `Restaurant.suspend()`/`Organization.reactivate()`'s existing
   * idempotency convention.
   */
  archive(at: Date): AcquisitionPricingRule {
    if (this.props.archivedAt !== null) {
      return this;
    }
    return AcquisitionPricingRule.reconstitute({
      ...this.props,
      archivedAt: at,
      updatedAt: at,
    });
  }

  /** Whether this rule is a live candidate for resolution at the given instant. */
  isActiveAt(at: Date): boolean {
    if (this.props.archivedAt !== null) {
      return false;
    }
    if (this.props.effectiveFrom.getTime() > at.getTime()) {
      return false;
    }
    if (this.props.effectiveTo !== null && this.props.effectiveTo.getTime() <= at.getTime()) {
      return false;
    }
    return true;
  }

  toProps(): Readonly<AcquisitionPricingRuleProps> {
    return { ...this.props };
  }
}

function validate(props: {
  scopeType: PricingScopeType;
  scopeId: string | null;
  feeType: PricingFeeType;
  flatAmount: number | null;
  flatCurrency: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  label: string;
}): void {
  if (props.feeType === PricingFeeType.Percentage) {
    throw new PercentagePricingNotSupportedException();
  }
  if (props.scopeType === PricingScopeType.Platform && props.scopeId !== null) {
    throw new InvalidPricingRuleException('scopeId must be null when scopeType is Platform.');
  }
  if (props.scopeType !== PricingScopeType.Platform && props.scopeId === null) {
    throw new InvalidPricingRuleException(
      'scopeId is required when scopeType is Organization or Restaurant.',
    );
  }
  if (props.flatAmount === null || props.flatCurrency === null) {
    throw new InvalidPricingRuleException(
      'flatAmount and flatCurrency are both required for feeType Flat.',
    );
  }
  if (!Number.isFinite(props.flatAmount) || props.flatAmount < 0) {
    throw new InvalidPricingRuleException('flatAmount must be a non-negative finite number.');
  }
  if (props.flatCurrency.trim().length === 0) {
    throw new InvalidPricingRuleException('flatCurrency must not be empty.');
  }
  if (props.label.trim().length === 0) {
    throw new InvalidPricingRuleException('label must not be empty.');
  }
  if (props.label.length > MAX_LABEL_LENGTH) {
    throw new InvalidPricingRuleException(`label must not exceed ${MAX_LABEL_LENGTH} characters.`);
  }
  if (props.effectiveTo !== null && props.effectiveTo.getTime() <= props.effectiveFrom.getTime()) {
    throw new InvalidPricingRuleException('effectiveTo must be strictly after effectiveFrom.');
  }
}
