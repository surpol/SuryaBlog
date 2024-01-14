-- UP
CREATE TABLE Posts (
	id Integer PRIMARY KEY,
	title String, 
	preview String,
	text String,
	date_created TEXT
)
-- DOWN
DROP TABLE Posts