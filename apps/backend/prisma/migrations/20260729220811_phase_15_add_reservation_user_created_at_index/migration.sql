-- CreateIndex
CREATE INDEX "reservations_user_id_created_at_idx" ON "reservations"("user_id", "created_at");
