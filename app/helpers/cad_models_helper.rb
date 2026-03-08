module CadModelsHelper
  def status_badge_class(status)
    case status.to_sym
    when :pending    then "bg-gray-100 text-gray-600"
    when :processing then "bg-blue-100 text-blue-700"
    when :done       then "bg-green-100 text-green-700"
    when :failed     then "bg-red-100 text-red-700"
    end
  end

  def status_dot_class(status)
    case status.to_sym
    when :done       then "bg-green-400"
    when :processing then "bg-blue-400 animate-pulse"
    when :pending    then "bg-yellow-400"
    when :failed     then "bg-red-500"
    else                  "bg-gray-500"
    end
  end
end
