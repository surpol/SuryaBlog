-- UP

-- Create the Posts table
CREATE TABLE Posts (
	id INTEGER PRIMARY KEY,
	title TEXT, 
	preview TEXT,
	text TEXT,
	imagePath TEXT,
	date_created TEXT
);

-- Create the Tags table
CREATE TABLE Tags (
	id INTEGER PRIMARY KEY,
	name TEXT UNIQUE
);

-- Create the PostTags join table
CREATE TABLE PostTags (
	post_id INTEGER,
	tag_id INTEGER,
	FOREIGN KEY (post_id) REFERENCES Posts(id),
	FOREIGN KEY (tag_id) REFERENCES Tags(id),
	PRIMARY KEY (post_id, tag_id)
);

-- DOWN
DROP TABLE PostTags;
DROP TABLE Tags;
DROP TABLE Posts;