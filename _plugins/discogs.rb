require 'net/http'
require 'uri'
require 'json'
require 'yaml'
require 'fileutils'
require 'openssl'

module Discogs
  class CollectionFetcher
    def initialize(token, username)
      @token = token
      @username = username
      @base_delay = 5 # 5 second delay between requests
    end

    def fetch_collection
      puts "Fetching Discogs collection for user: #{@username}"
      
      url = "https://api.discogs.com/users/#{@username}/collection/folders/0/releases?token=#{@token}"
      result = []

      loop do
        puts "Fetching page: #{url}"
        response = make_request(url)
        
        break if response.nil?
        
        data = JSON.parse(response.body)
        
        if data['releases']
          result.concat(data['releases'])
          puts "Fetched #{data['releases'].length} releases (total: #{result.length})"
        end

        # Check for next page
        if data.dig('pagination', 'urls', 'next')
          url = data['pagination']['urls']['next']
        else
          break
        end
      end

      puts "Total releases fetched: #{result.length}"
      result
    end

    def process_collection(releases)
      # Sort by date_added (newest first)
      releases.sort! do |a, b|
        a_date = DateTime.parse(a['date_added'])
        b_date = DateTime.parse(b['date_added'])
        b_date <=> a_date
      end

      clean = {}
      images_dir = File.join(Dir.pwd, 'assets', 'data', 'discogs')
      FileUtils.mkdir_p(images_dir)

      releases.each do |item|
        basic_info = item['basic_information']
        
        # Build artist name
        artist_name = basic_info['artists'].map do |artist|
          artist['name'].gsub(/\(\d+\)$/, '').strip
        end.join(', ')

        # Handle cover image
        cover_url = basic_info['cover_image']
        master_id = basic_info['master_id']
        local_image_path = "/assets/data/discogs/#{master_id}.jpg"
        local_file_path = File.join(Dir.pwd, local_image_path)

        # Download image if it doesn't exist (unless SKIP_DISCOGS_ASSETS is set)
        if File.exist?(local_file_path)
          cover_url = local_image_path
        elsif cover_url && !cover_url.empty? && ENV['SKIP_DISCOGS_ASSETS'] != 'true'
          begin
            puts "Downloading cover image: #{cover_url}"
            sleep(@base_delay)
            image_data = make_request(cover_url)
            if image_data
              File.binwrite(local_file_path, image_data.body)
              cover_url = local_image_path
              puts "  ✓ Saved to #{local_image_path}"
            end
          rescue => e
            puts "  ✗ Failed to download #{cover_url}: #{e.message}"
          end
        end
        # When SKIP_DISCOGS_ASSETS is set and no local file: cover_url stays the remote URL

        clean[master_id] = {
          'artist' => artist_name,
          'title' => basic_info['title'],
          'year' => basic_info['year'],
          'date_added' => item['date_added'],
          'cover_image' => cover_url,
          'master_id' => master_id,
          'id' => item['id']
        }
      end

      clean
    end

    def save_collection(collection)
      data_dir = File.join(Dir.pwd, '_data')
      FileUtils.mkdir_p(data_dir)
      
      output_file = File.join(data_dir, 'collection.yaml')
      File.write(output_file, YAML.dump(collection))
      puts "✓ Saved #{collection.length} items to #{output_file}"
    end

    private

    def make_request(url)
      uri = URI.parse(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      # Use VERIFY_NONE to skip certificate verification issues
      http.verify_mode = OpenSSL::SSL::VERIFY_NONE
      http.open_timeout = 10
      http.read_timeout = 10
      
      request = Net::HTTP::Get.new(uri.request_uri)
      request['User-Agent'] = 'DiscogsCollectionFetcher/1.0'
      
      response = http.request(request)
      
      if response.code.to_i == 200
        response
      else
        puts "Error fetching #{url}: HTTP #{response.code}"
        nil
      end
    rescue => e
      puts "Error fetching #{url}: #{e.message}"
      nil
    end
  end

  # Jekyll Hook to fetch Discogs collection before site generation
  # Runs on every Jekyll start when DISCOGS_TOKEN is set (username from discogs_username in _config.yml).
  Jekyll::Hooks.register :site, :after_init do |site|
    token = ENV['DISCOGS_TOKEN']
    username = site.config['discogs_username']

    if token.nil? || token.empty?
      puts "Discogs: DISCOGS_TOKEN not set, skipping fetch (using existing _data/collection.yaml if present)"
      next
    end

    if username.nil? || username.to_s.empty?
      puts "Discogs: discogs_username not set in _config.yml, skipping fetch"
      next
    end

    puts "\n" + "=" * 60
    puts "Fetching Discogs Collection"
    puts "=" * 60

    fetcher = CollectionFetcher.new(token, username)

    begin
      releases = fetcher.fetch_collection
      collection = fetcher.process_collection(releases)
      fetcher.save_collection(collection)

      puts "=" * 60
      puts "Discogs collection fetch complete!"
      puts "=" * 60 + "\n"
    rescue => e
      puts "ERROR: Failed to fetch Discogs collection: #{e.message}"
      puts e.backtrace.join("\n")
    end
  end
end

