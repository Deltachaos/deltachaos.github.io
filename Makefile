dev:
	php bin/console.php fetch-discogs
	JEKYLL_ENV=development bundle exec jekyll serve
