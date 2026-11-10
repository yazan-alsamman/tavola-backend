import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { MenuPriceLevelRepository } from '../../domain/repositories/menu-price-level.repository';
import {
  PRICE_LEVEL_COUNT,
  PRICE_LEVEL_REFERENCE_ITEMS,
  PRICE_LEVEL_SKIPPED_TOP_ITEMS,
} from '../../domain/policies/price-level.policy';

/**
 * ADR-046, in SQL so all branches are ranked in one pass. Mirrors
 * `referencePriceOf`/`priceLevelOf` exactly:
 * - a branch reads its own default Menu, else the restaurant's shared one;
 * - reference price = average of the items ranked 2..11 by price;
 * - level = ceil(cume_dist * 4) among branches with the same currency
 *   (the branch's, else the restaurant's default currency).
 * A branch with no reference price gets nulls. The restaurant's legacy
 * `price_level` becomes the rounded average of its branches' levels, and is
 * left as it was when none of its branches has one yet.
 */
@Injectable()
export class PrismaMenuPriceLevelRepository implements MenuPriceLevelRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async recomputeAll(): Promise<number> {
    const firstRank = PRICE_LEVEL_SKIPPED_TOP_ITEMS + 1;
    const lastRank = PRICE_LEVEL_SKIPPED_TOP_ITEMS + PRICE_LEVEL_REFERENCE_ITEMS;
    const branches = await this.prismaContext.client.$executeRaw`
      WITH effective_menu AS (
        SELECT b.id AS branch_id,
               COALESCE(b.currency, rs.default_currency, '') AS currency,
               COALESCE(
                 (SELECT m.id FROM menus m
                   WHERE m.branch_id = b.id AND m.is_default AND m.active AND m.deleted_at IS NULL
                   LIMIT 1),
                 (SELECT m.id FROM menus m
                   WHERE m.restaurant_id = b.restaurant_id AND m.branch_id IS NULL
                     AND m.is_default AND m.active AND m.deleted_at IS NULL
                   LIMIT 1)
               ) AS menu_id
        FROM branches b
        JOIN restaurants r ON r.id = b.restaurant_id AND r.deleted_at IS NULL
        LEFT JOIN restaurant_settings rs ON rs.restaurant_id = b.restaurant_id
        WHERE b.deleted_at IS NULL
      ),
      ranked AS (
        SELECT em.branch_id, mi.price,
               ROW_NUMBER() OVER (PARTITION BY em.branch_id ORDER BY mi.price DESC, mi.id) AS rn
        FROM effective_menu em
        JOIN menu_categories mc ON mc.menu_id = em.menu_id AND mc.deleted_at IS NULL
        JOIN menu_items mi ON mi.category_id = mc.id AND mi.deleted_at IS NULL AND mi.price > 0
      ),
      reference AS (
        SELECT branch_id, ROUND(AVG(price), 2) AS reference_price
        FROM ranked
        WHERE rn BETWEEN ${firstRank}::int AND ${lastRank}::int
        GROUP BY branch_id
      ),
      leveled AS (
        SELECT em.branch_id, ref.reference_price,
               LEAST(${PRICE_LEVEL_COUNT}::int, GREATEST(1, CEIL(
                 CUME_DIST() OVER (PARTITION BY em.currency ORDER BY ref.reference_price)
                 * ${PRICE_LEVEL_COUNT}::int
               )))::int AS price_level
        FROM effective_menu em
        JOIN reference ref ON ref.branch_id = em.branch_id
      ),
      next AS (
        SELECT em.branch_id, l.reference_price, l.price_level
        FROM effective_menu em
        LEFT JOIN leveled l ON l.branch_id = em.branch_id
      )
      UPDATE branches b
      SET reference_price = next.reference_price, price_level = next.price_level
      FROM next
      WHERE b.id = next.branch_id
        AND (b.reference_price IS DISTINCT FROM next.reference_price
          OR b.price_level IS DISTINCT FROM next.price_level)
    `;
    await this.prismaContext.client.$executeRaw`
      UPDATE restaurants r
      SET price_level = agg.level
      FROM (
        SELECT restaurant_id, ROUND(AVG(price_level))::int AS level
        FROM branches
        WHERE deleted_at IS NULL AND price_level IS NOT NULL
        GROUP BY restaurant_id
      ) agg
      WHERE r.id = agg.restaurant_id AND r.price_level IS DISTINCT FROM agg.level
    `;
    return branches;
  }
}
