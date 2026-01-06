-- Add visual gene columns to Variant table
ALTER TABLE Variant ADD COLUMN colorScheme TEXT DEFAULT 'classic';
ALTER TABLE Variant ADD COLUMN layout TEXT DEFAULT 'centered';
ALTER TABLE Variant ADD COLUMN buttonStyle TEXT DEFAULT 'solid';
ALTER TABLE Variant ADD COLUMN animation TEXT DEFAULT 'fade';
ALTER TABLE Variant ADD COLUMN typography TEXT DEFAULT 'modern';
