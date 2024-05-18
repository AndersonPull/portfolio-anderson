using Newtonsoft.Json;

namespace Portfolio;

public class UserModel
{
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("profile_image")]
        public string ProfileImage { get; set; }
}
