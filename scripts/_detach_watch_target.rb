require 'xcodeproj'
project = Xcodeproj::Project.open('ios/titangolf.xcodeproj')

main_target = project.targets.find { |t| t.name == 'titangolf' }

# Remove the "Embed Watch Content" copy-files phase entirely — its only job
# is embedding the Watch App's .app bundle.
embed_phase = main_target.build_phases.find { |bp| bp.respond_to?(:name) && bp.name == 'Embed Watch Content' }
if embed_phase
  main_target.build_phases.delete(embed_phase)
  puts "Removed 'Embed Watch Content' build phase"
end

# Remove only the dependency edge on the Watch App target — leave
# TitanGolfActivityExtension's dependency untouched.
watch_dep = main_target.dependencies.find { |d| d.target&.name == 'titangolf Watch App Watch App' }
if watch_dep
  main_target.dependencies.delete(watch_dep)
  puts "Removed dependency on 'titangolf Watch App Watch App'"
end

project.save
puts "Saved."
