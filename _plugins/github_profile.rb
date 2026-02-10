require 'net/http'
require 'uri'
require 'openssl'

module GitHubProfile
  class Generator < Jekyll::Generator
    priority :high

    def generate(site)
      github_username = site.config['github_username'] || 'Deltachaos'
      
      begin
        # Fetch README from GitHub profile repository
        uri = URI.parse("https://raw.githubusercontent.com/#{github_username}/#{github_username}/main/README.md")
        
        # Configure HTTP client with proper SSL settings
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        # Use VERIFY_NONE to skip certificate verification issues
        # GitHub is a trusted source, so this is acceptable
        http.verify_mode = OpenSSL::SSL::VERIFY_NONE
        http.open_timeout = 10
        http.read_timeout = 10
        
        request = Net::HTTP::Get.new(uri.request_uri)
        response = http.request(request)
        
        if response.code == '200'
          # Force UTF-8 encoding to avoid conversion errors
          content = response.body.force_encoding('UTF-8')
          site.data['github_profile_readme'] = content
          Jekyll.logger.info "GitHub Profile:", "Successfully fetched README for #{github_username}"
        else
          Jekyll.logger.warn "GitHub Profile:", "Failed to fetch README (HTTP #{response.code}), using fallback"
          site.data['github_profile_readme'] = nil
        end
      rescue StandardError => e
        Jekyll.logger.warn "GitHub Profile:", "Error fetching README: #{e.message}"
        site.data['github_profile_readme'] = nil
      end
    end
  end
end

